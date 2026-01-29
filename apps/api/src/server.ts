import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import cors from "@fastify/cors";
import bcrypt from "bcryptjs";
import { OpenOverride, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma";
import {
  authenticateAgent,
  generateToken,
  getBearerToken,
  hashToken,
  requireAdmin,
} from "./auth";
import { buildOrderPdf } from "./pdf";

const slugRegex = /^[a-z0-9-]+$/;

const normalizeSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const app = Fastify({
  logger: true,
});

const storeCookieName = "sp_store_token";
const storeCookieMaxAge = 60 * 60 * 24 * 30;
const cookieDomain = process.env.COOKIE_DOMAIN;
const storeCookieSameSite = (() => {
  const normalized = process.env.COOKIE_SAMESITE?.toLowerCase();
  if (normalized === "none" || normalized === "lax" || normalized === "strict") {
    return normalized;
  }
  return process.env.NODE_ENV === "production" ? "none" : "lax";
})();
const storeCookieSecure =
  process.env.NODE_ENV === "production" || storeCookieSameSite === "none";

const orderStreamClients = new Map<string, Set<FastifyReply>>();
const orderStreamPingers = new Map<FastifyReply, NodeJS.Timeout>();

const parseOrigins = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const buildAllowedOrigins = () => {
  const corsOrigins = parseOrigins(process.env.CORS_ORIGIN);
  const baseOrigins =
    corsOrigins.length > 0
      ? corsOrigins
      : [
          "https://painel.smartpedidos.com.br",
          "https://p.smartpedidos.com.br",
          ...parseOrigins(process.env.STORE_PANEL_ORIGINS),
          ...parseOrigins(process.env.PUBLIC_PANEL_ORIGINS),
        ];
  const origins = new Set<string>(baseOrigins);

  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:5173");
    origins.add("http://localhost:3000");
  }

  return origins;
};

const buildStoreCookieOptions = () => ({
  httpOnly: true,
  secure: storeCookieSecure,
  sameSite: storeCookieSameSite as "lax" | "none" | "strict",
  path: "/",
  maxAge: storeCookieMaxAge,
  ...(cookieDomain ? { domain: cookieDomain } : {}),
});

const buildStoreLogoutCookieOptions = () => ({
  httpOnly: true,
  secure: storeCookieSecure,
  sameSite: storeCookieSameSite as "lax" | "none" | "strict",
  path: "/",
  maxAge: 0,
  ...(cookieDomain ? { domain: cookieDomain } : {}),
});

const sendOrderStreamEvent = (
  storeId: string,
  event: string,
  payload: Record<string, unknown>
) => {
  const storeStreams = orderStreamClients.get(storeId);
  if (!storeStreams) {
    return;
  }
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  storeStreams.forEach((client) => {
    try {
      client.raw.write(message);
    } catch {
      const ping = orderStreamPingers.get(client);
      if (ping) {
        clearInterval(ping);
        orderStreamPingers.delete(client);
      }
      storeStreams.delete(client);
    }
  });
  if (storeStreams.size === 0) {
    orderStreamClients.delete(storeId);
  }
};

const normalizeOptionGroupRules = ({
  type,
  required,
  minSelect,
  maxSelect,
}: {
  type: "SINGLE" | "MULTI";
  required: boolean;
  minSelect: number;
  maxSelect: number;
}) => {
  let normalizedMin = minSelect;
  let normalizedMax = maxSelect;

  if (type === "SINGLE") {
    normalizedMin = required ? 1 : 0;
    normalizedMax = 1;
  } else {
    if (required && normalizedMin === 0) {
      normalizedMin = 1;
    }
    if (normalizedMax > 0 && normalizedMax < normalizedMin) {
      return {
        ok: false,
        message: "O máximo deve ser maior ou igual ao mínimo.",
      };
    }
  }

  return {
    ok: true as const,
    minSelect: normalizedMin,
    maxSelect: normalizedMax,
  };
};

type StoreHoursData = {
  timezone: string;
  monOpen: string | null;
  monClose: string | null;
  monEnabled: boolean;
  tueOpen: string | null;
  tueClose: string | null;
  tueEnabled: boolean;
  wedOpen: string | null;
  wedClose: string | null;
  wedEnabled: boolean;
  thuOpen: string | null;
  thuClose: string | null;
  thuEnabled: boolean;
  friOpen: string | null;
  friClose: string | null;
  friEnabled: boolean;
  satOpen: string | null;
  satClose: string | null;
  satEnabled: boolean;
  sunOpen: string | null;
  sunClose: string | null;
  sunEnabled: boolean;
  isOpenNowOverride: OpenOverride;
  closedMessage: string | null;
};

const defaultHours: StoreHoursData = {
  timezone: "America/Sao_Paulo",
  monOpen: null,
  monClose: null,
  monEnabled: false,
  tueOpen: null,
  tueClose: null,
  tueEnabled: false,
  wedOpen: null,
  wedClose: null,
  wedEnabled: false,
  thuOpen: null,
  thuClose: null,
  thuEnabled: false,
  friOpen: null,
  friClose: null,
  friEnabled: false,
  satOpen: null,
  satClose: null,
  satEnabled: false,
  sunOpen: null,
  sunClose: null,
  sunEnabled: false,
  isOpenNowOverride: OpenOverride.AUTO,
  closedMessage: null,
};

const parseTimeToMinutes = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
};

const getLocalTimeParts = (timezone: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  return {
    weekday,
    minutes:
      hour && minute ? Number(hour) * 60 + Number(minute) : Number.NaN,
  };
};

const calculateIsOpenNow = (hours: StoreHoursData) => {
  if (hours.isOpenNowOverride === OpenOverride.FORCE_OPEN) {
    return true;
  }
  if (hours.isOpenNowOverride === OpenOverride.FORCE_CLOSED) {
    return false;
  }

  const { weekday, minutes } = getLocalTimeParts(hours.timezone);
  if (!weekday || Number.isNaN(minutes)) {
    return true;
  }

  const dayMap: Record<string, string> = {
    Mon: "mon",
    Tue: "tue",
    Wed: "wed",
    Thu: "thu",
    Fri: "fri",
    Sat: "sat",
    Sun: "sun",
  };
  const dayKey = dayMap[weekday];
  if (!dayKey) {
    return true;
  }

  const enabled = hours[`${dayKey}Enabled` as keyof typeof hours];
  const openValue = hours[`${dayKey}Open` as keyof typeof hours];
  const closeValue = hours[`${dayKey}Close` as keyof typeof hours];

  if (!enabled || typeof openValue !== "string" || typeof closeValue !== "string") {
    return false;
  }

  const openMinutes = parseTimeToMinutes(openValue);
  const closeMinutes = parseTimeToMinutes(closeValue);
  if (openMinutes === null || closeMinutes === null) {
    return false;
  }

  if (closeMinutes < openMinutes) {
    return minutes >= openMinutes || minutes < closeMinutes;
  }

  return minutes >= openMinutes && minutes <= closeMinutes;
};

const getStoreIdFromToken = (token: string) => {
  try {
    const payload = app.jwt.verify<{
      role?: string;
      storeId?: string;
    }>(token);
    if (payload.role !== "store" || !payload.storeId) {
      return null;
    }
    return payload.storeId;
  } catch {
    return null;
  }
};

const requireStoreAuth = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  let token: string | null = getBearerToken(request);
  if (!token && request.cookies) {
    const cookieToken = request.cookies[storeCookieName];
    if (typeof cookieToken === "string" && cookieToken.trim()) {
      token = cookieToken.trim();
    }
  }

  if (!token) {
    return reply.status(401).send({ message: "Unauthorized" });
  }

  const storeId = getStoreIdFromToken(token);
  if (!storeId) {
    return reply.status(401).send({ message: "Unauthorized" });
  }

  request.storeId = storeId;
};

const registerRoutes = () => {
  app.decorateRequest("storeId", null);

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/public/:slug/menu", async (request, reply) => {
    const paramsSchema = z.object({ slug: z.string() });
    const { slug } = paramsSchema.parse(request.params);

    const store = await prisma.store.findUnique({
      where: { slug },
      include: {
        categories: {
          where: { active: true },
          include: {
            products: {
              where: { active: true },
              include: {
                optionGroups: {
                  include: {
                    items: {
                      where: { isActive: true },
                      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                    },
                  },
                  orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                },
              },
            },
          },
        },
        deliveryAreas: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
        hours: true,
        paymentSettings: true,
      },
    });

    if (!store || !store.isActive) {
      return reply.status(404).send({ message: "Store not found" });
    }

    const hours = store.hours
      ? {
          timezone: store.hours.timezone,
          monOpen: store.hours.monOpen,
          monClose: store.hours.monClose,
          monEnabled: store.hours.monEnabled,
          tueOpen: store.hours.tueOpen,
          tueClose: store.hours.tueClose,
          tueEnabled: store.hours.tueEnabled,
          wedOpen: store.hours.wedOpen,
          wedClose: store.hours.wedClose,
          wedEnabled: store.hours.wedEnabled,
          thuOpen: store.hours.thuOpen,
          thuClose: store.hours.thuClose,
          thuEnabled: store.hours.thuEnabled,
          friOpen: store.hours.friOpen,
          friClose: store.hours.friClose,
          friEnabled: store.hours.friEnabled,
          satOpen: store.hours.satOpen,
          satClose: store.hours.satClose,
          satEnabled: store.hours.satEnabled,
          sunOpen: store.hours.sunOpen,
          sunClose: store.hours.sunClose,
          sunEnabled: store.hours.sunEnabled,
          isOpenNowOverride: store.hours.isOpenNowOverride,
          closedMessage: store.hours.closedMessage,
        }
      : defaultHours;

    const paymentSettings = store.paymentSettings ?? {
      acceptPix: true,
      acceptCash: true,
      acceptCard: true,
      pixKey: null,
      pixName: null,
      pixBank: null,
    };

    return {
      store: {
        name: store.name,
        slug: store.slug,
        isOpenNow: store.hours ? calculateIsOpenNow(hours) : true,
        closedMessage: hours.closedMessage,
      },
      categories: store.categories.map((category) => ({
        id: category.id,
        name: category.name,
        products: category.products.map((product) => ({
          id: product.id,
          name: product.name,
          priceCents: Math.round(product.price.toNumber() * 100),
          active: product.active,
          optionGroups: product.optionGroups.map((group) => ({
            id: group.id,
            name: group.name,
            type: group.type,
            required: group.required,
            minSelect: group.minSelect,
            maxSelect: group.maxSelect,
            sortOrder: group.sortOrder,
            items: group.items.map((item) => ({
              id: item.id,
              name: item.name,
              priceDeltaCents: item.priceDeltaCents,
              isActive: item.isActive,
              sortOrder: item.sortOrder,
            })),
          })),
        })),
      })),
      deliveryAreas: store.deliveryAreas.map((area) => ({
        id: area.id,
        name: area.name,
        feeCents: area.feeCents,
      })),
      hours,
      payment: paymentSettings,
    };
  });

  app.post("/public/:slug/orders", async (request, reply) => {
    const paramsSchema = z.object({ slug: z.string() });
    const addressSchema = z.object({
      line: z.string().min(1),
      number: z.string().min(1),
      neighborhood: z.string().min(1),
      city: z.string().min(1),
      reference: z.string().min(1).optional(),
    });
    const bodySchema = z.object({
      customerName: z.string().min(1),
      customerPhone: z.string().min(1),
      orderType: z.enum(["PICKUP", "DELIVERY"]).optional(),
      fulfillmentType: z.enum(["PICKUP", "DELIVERY"]).optional(),
      notes: z.string().min(1).optional(),
      address: addressSchema.optional(),
      deliveryAreaId: z.string().uuid().optional(),
      addressLine: z.string().min(1).optional(),
      addressNumber: z.string().min(1).optional(),
      addressNeighborhood: z.string().min(1).optional(),
      addressCity: z.string().min(1).optional(),
      addressRef: z.string().min(1).optional(),
      paymentMethod: z.enum(["PIX", "CASH", "CARD"]),
      changeForCents: z.number().int().nonnegative().optional(),
      items: z
        .array(
          z.object({
            productId: z.string().uuid(),
            quantity: z.number().int().positive(),
            notes: z.string().min(1).optional(),
            options: z
              .array(
                z.object({
                  groupId: z.string().uuid(),
                  itemIds: z.array(z.string().uuid()).min(1),
                })
              )
              .optional(),
          })
        )
        .min(1),
    });

    const { slug } = paramsSchema.parse(request.params);
    const {
      items,
      fulfillmentType,
      orderType,
      address,
      customerName,
      customerPhone,
      notes,
      deliveryAreaId,
      addressLine,
      addressNumber,
      addressNeighborhood,
      addressCity,
      addressRef,
      paymentMethod,
      changeForCents,
    } = bodySchema.parse(request.body);

    const normalizedOrderType = orderType ?? fulfillmentType ?? "PICKUP";
    const isDelivery = normalizedOrderType === "DELIVERY";

    const store = await prisma.store.findUnique({
      where: { slug },
      include: {
        hours: true,
        paymentSettings: true,
      },
    });

    if (!store || !store.isActive) {
      return reply.status(404).send({ message: "Store not found" });
    }

    const hours = store.hours
      ? {
          timezone: store.hours.timezone,
          monOpen: store.hours.monOpen,
          monClose: store.hours.monClose,
          monEnabled: store.hours.monEnabled,
          tueOpen: store.hours.tueOpen,
          tueClose: store.hours.tueClose,
          tueEnabled: store.hours.tueEnabled,
          wedOpen: store.hours.wedOpen,
          wedClose: store.hours.wedClose,
          wedEnabled: store.hours.wedEnabled,
          thuOpen: store.hours.thuOpen,
          thuClose: store.hours.thuClose,
          thuEnabled: store.hours.thuEnabled,
          friOpen: store.hours.friOpen,
          friClose: store.hours.friClose,
          friEnabled: store.hours.friEnabled,
          satOpen: store.hours.satOpen,
          satClose: store.hours.satClose,
          satEnabled: store.hours.satEnabled,
          sunOpen: store.hours.sunOpen,
          sunClose: store.hours.sunClose,
          sunEnabled: store.hours.sunEnabled,
          isOpenNowOverride: store.hours.isOpenNowOverride,
          closedMessage: store.hours.closedMessage,
        }
      : defaultHours;

    const isOpenNow = store.hours ? calculateIsOpenNow(hours) : true;

    if (!isOpenNow) {
      return reply.status(400).send({
        message: hours.closedMessage || "A loja está fechada no momento.",
      });
    }

    const paymentSettings = store.paymentSettings ?? {
      acceptPix: true,
      acceptCash: true,
      acceptCard: true,
    };

    const paymentAllowed =
      (paymentMethod === "PIX" && paymentSettings.acceptPix) ||
      (paymentMethod === "CASH" && paymentSettings.acceptCash) ||
      (paymentMethod === "CARD" && paymentSettings.acceptCard);

    if (!paymentAllowed) {
      return reply
        .status(400)
        .send({ message: "Forma de pagamento indisponível." });
    }

    const normalizedAddressLine = addressLine ?? address?.line ?? null;
    const normalizedAddressNumber = addressNumber ?? address?.number ?? null;
    const normalizedAddressNeighborhood =
      addressNeighborhood ?? address?.neighborhood ?? null;
    const normalizedAddressCity = addressCity ?? address?.city ?? null;
    const normalizedAddressRef = addressRef ?? address?.reference ?? null;

    if (isDelivery && !deliveryAreaId) {
      return reply
        .status(400)
        .send({ message: "Selecione um bairro para entrega." });
    }

    if (isDelivery && !normalizedAddressLine) {
      return reply.status(400).send({ message: "Endereço é obrigatório." });
    }

    const productIds = items.map((item) => item.productId);
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        category: {
          storeId: store.id,
        },
        active: true,
      },
      include: {
        optionGroups: {
          include: {
            items: true,
          },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
    });

    if (products.length !== productIds.length) {
      return reply
        .status(400)
        .send({ message: "One or more products are invalid" });
    }

    const productMap = new Map(products.map((product) => [product.id, product]));
    const normalizedItems = items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) {
        return null;
      }
      const unitPriceCents = Math.round(product.price.toNumber() * 100);
      const selectionInputs = item.options ?? [];
      const groupIds = new Set(product.optionGroups.map((group) => group.id));
      const invalidGroup = selectionInputs.find(
        (selection) => !groupIds.has(selection.groupId)
      );
      if (invalidGroup) {
        return null;
      }

      const optionEntries: Array<{
        groupName: string;
        itemName: string;
        priceDeltaCents: number;
      }> = [];
      let optionTotalCents = 0;

      for (const group of product.optionGroups) {
        const selectedIds =
          selectionInputs.find((selection) => selection.groupId === group.id)
            ?.itemIds ?? [];
        const uniqueSelectedIds = [...new Set(selectedIds)];
        const activeItems = group.items.filter((option) => option.isActive);
        const activeMap = new Map(activeItems.map((option) => [option.id, option]));
        const selectedItems = uniqueSelectedIds.map((optionId) =>
          activeMap.get(optionId)
        );

        if (selectedItems.some((option) => !option)) {
          return null;
        }

        const minRequired = group.required
          ? Math.max(group.minSelect, 1)
          : group.minSelect;
        const maxAllowed =
          group.type === "SINGLE"
            ? 1
            : group.maxSelect > 0
              ? group.maxSelect
              : Number.POSITIVE_INFINITY;

        if (
          selectedItems.length < minRequired ||
          selectedItems.length > maxAllowed
        ) {
          return null;
        }

        selectedItems.forEach((option) => {
          optionEntries.push({
            groupName: group.name,
            itemName: option!.name,
            priceDeltaCents: option!.priceDeltaCents,
          });
          optionTotalCents += option!.priceDeltaCents;
        });
      }

      return {
        ...item,
        unitPriceCents: unitPriceCents + optionTotalCents,
        optionEntries,
      };
    });

    if (normalizedItems.some((item) => item === null)) {
      return reply
        .status(400)
        .send({ message: "One or more products are invalid" });
    }

    const subtotalCents = normalizedItems.reduce((acc, item) => {
      if (!item) {
        return acc;
      }
      return acc + item.unitPriceCents * item.quantity;
    }, 0);
    let deliveryFeeCents = 0;
    let deliveryNeighborhood = normalizedAddressNeighborhood;

    if (isDelivery) {
      const area = await prisma.deliveryArea.findFirst({
        where: {
          id: deliveryAreaId,
          storeId: store.id,
          isActive: true,
        },
      });
      if (!area) {
        return reply
          .status(400)
          .send({ message: "Bairro de entrega inválido." });
      }
      deliveryFeeCents = area.feeCents;
      deliveryNeighborhood = area.name;
    }

    const totalCents = subtotalCents + deliveryFeeCents;
    const total = totalCents / 100;

    if (
      paymentMethod === "CASH" &&
      changeForCents !== undefined &&
      changeForCents < totalCents
    ) {
      return reply.status(400).send({
        message: "Troco deve ser maior ou igual ao total do pedido.",
      });
    }

    const order = await prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          storeId: store.id,
          status: "NEW",
          fulfillmentType: normalizedOrderType,
          customerName,
          customerPhone,
          notes: notes ?? null,
          addressLine: isDelivery ? normalizedAddressLine : null,
          addressNumber: isDelivery ? normalizedAddressNumber : null,
          addressNeighborhood: isDelivery ? deliveryNeighborhood : null,
          addressCity: isDelivery ? normalizedAddressCity : null,
          addressReference:
            isDelivery ? normalizedAddressRef : null,
          deliveryAreaId: isDelivery ? deliveryAreaId ?? null : null,
          deliveryFeeCents,
          paymentMethod,
          changeForCents:
            paymentMethod === "CASH" ? changeForCents ?? null : null,
          total,
        },
      });

      for (const item of normalizedItems) {
        const createdItem = await tx.orderItem.create({
          data: {
            orderId: createdOrder.id,
            productId: item!.productId,
            quantity: item!.quantity,
            unitPriceCents: item!.unitPriceCents,
            notes: item!.notes ?? null,
          },
        });

        if (item!.optionEntries.length > 0) {
          await tx.orderItemOption.createMany({
            data: item!.optionEntries.map((option) => ({
              orderItemId: createdItem.id,
              groupName: option.groupName,
              itemName: option.itemName,
              priceDeltaCents: option.priceDeltaCents,
            })),
          });
        }
      }

      return createdOrder;
    });

    sendOrderStreamEvent(store.id, "order.created", {
      orderId: order.id,
      storeId: store.id,
    });

    return reply.status(201).send({
      orderId: order.id,
      number: order.id.slice(0, 6),
      status: order.status,
    });
  });

  app.post("/auth/store/login", async (request, reply) => {
    const bodySchema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });

    const { email, password } = bodySchema.parse(request.body);

    const store = await prisma.store.findUnique({
      where: { email },
    });

    if (!store || !store.isActive || !store.passwordHash) {
      return reply.status(401).send({ message: "Invalid credentials" });
    }

    const passwordMatches = await bcrypt.compare(password, store.passwordHash);
    if (!passwordMatches) {
      return reply.status(401).send({ message: "Invalid credentials" });
    }

    const token = app.jwt.sign(
      { role: "store", storeId: store.id },
      { sub: store.id }
    );

    reply.setCookie(storeCookieName, token, buildStoreCookieOptions());

    return reply.send({
      token,
      store: {
        id: store.id,
        name: store.name,
        slug: store.slug,
      },
    });
  });

  app.post("/auth/store/logout", async (_request, reply) => {
    reply.setCookie(storeCookieName, "", buildStoreLogoutCookieOptions());
    return reply.send({ ok: true });
  });

  app.post("/auth/admin/bootstrap", async (request, reply) => {
    const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
    const headerToken = request.headers["x-bootstrap-token"];

    if (!bootstrapToken) {
      return reply.status(403).send({ message: "Bootstrap disabled" });
    }

    if (headerToken !== bootstrapToken) {
      return reply.status(401).send({ message: "Invalid bootstrap token" });
    }

    const adminExists = await prisma.admin.count();
    if (adminExists > 0) {
      return reply.status(409).send({ message: "Admin already exists" });
    }

    const schema = z.object({
      name: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(6),
    });

    const { name, email, password } = schema.parse(request.body);

    const passwordHash = await bcrypt.hash(password, 10);

    const admin = await prisma.admin.create({
      data: { name, email, passwordHash },
      select: { id: true, name: true, email: true },
    });

    const token = await reply.jwtSign(
      { sub: admin.id, role: "admin" },
      { expiresIn: "7d" }
    );

    return reply.send({ admin, token });
  });

  app.post("/auth/admin/login", async (request, reply) => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });

    const { email, password } = schema.parse(request.body);

    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin || !admin.active) {
      return reply.status(401).send({ message: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) {
      return reply.status(401).send({ message: "Invalid credentials" });
    }

    const token = await reply.jwtSign(
      { sub: admin.id, role: "admin" },
      { expiresIn: "7d" }
    );

    return reply.send({
      admin: { id: admin.id, name: admin.name, email: admin.email },
      token,
    });
  });

  app.log.info("Admin auth routes registered");

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/admin")) {
      return;
    }

    return requireAdmin(request, reply);
  });

  app.get("/admin/stores", async (_request, reply) => {
    const stores = await prisma.store.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        isActive: true,
        createdAt: true,
      },
    });

    return reply.send(
      stores.map((store) => ({
        id: store.id,
        name: store.name,
        slug: store.slug,
        email: store.email,
        isActive: store.isActive,
        createdAt: store.createdAt,
      }))
    );
  });

  app.post("/admin/stores", async (request, reply) => {
    const bodySchema = z.object({
      name: z.string().min(1),
      slug: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(6),
      isActive: z.boolean().optional(),
    });

    const { name, slug, email, password, isActive } = bodySchema.parse(
      request.body
    );
    const normalizedSlug = normalizeSlug(slug);
    if (!slugRegex.test(normalizedSlug)) {
      return reply.status(400).send({ message: "Invalid slug" });
    }
    const passwordHash = await bcrypt.hash(password, 10);

    try {
      const store = await prisma.store.create({
        data: {
          name,
          slug: normalizedSlug,
          email,
          passwordHash,
          isActive: isActive ?? true,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          email: true,
          isActive: true,
          createdAt: true,
        },
      });

      return reply.status(201).send({
        id: store.id,
        name: store.name,
        slug: store.slug,
        email: store.email,
        isActive: store.isActive,
        createdAt: store.createdAt,
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        return reply.status(409).send({ message: "Store already exists" });
      }
      throw error;
    }
  });

  app.patch("/admin/stores/:id", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({
      name: z.string().min(1).optional(),
      slug: z.string().min(1).optional(),
      email: z.string().email().optional(),
      isActive: z.boolean().optional(),
    });

    const { id } = paramsSchema.parse(request.params);
    const { name, slug, email, isActive } = bodySchema.parse(request.body);

    if (!name && !slug && !email && isActive === undefined) {
      return reply.status(400).send({ message: "No changes provided" });
    }

    const normalizedSlug = slug ? normalizeSlug(slug) : undefined;
    if (normalizedSlug && !slugRegex.test(normalizedSlug)) {
      return reply.status(400).send({ message: "Invalid slug" });
    }

    try {
      const store = await prisma.store.update({
        where: { id },
        data: {
          name,
          slug: normalizedSlug,
          email,
          isActive,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          email: true,
          isActive: true,
          createdAt: true,
        },
      });

      return reply.send({
        id: store.id,
        name: store.name,
        slug: store.slug,
        email: store.email,
        isActive: store.isActive,
        createdAt: store.createdAt,
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        return reply.status(409).send({ message: "Store already exists" });
      }
      throw error;
    }
  });

  app.post("/admin/stores/:id/reset-password", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({
      password: z.string().min(6),
    });

    const { id } = paramsSchema.parse(request.params);
    const { password } = bodySchema.parse(request.body);

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.store.update({
      where: { id },
      data: { passwordHash },
    });

    return reply.send({ ok: true });
  });

  app.post("/admin/stores/:id/toggle", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });

    const { id } = paramsSchema.parse(request.params);

    const store = await prisma.store.findUnique({ where: { id } });
    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    const updated = await prisma.store.update({
      where: { id },
      data: { isActive: !store.isActive },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        isActive: true,
        createdAt: true,
      },
    });

    return reply.send({
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      email: updated.email,
      isActive: updated.isActive,
      createdAt: updated.createdAt,
    });
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/agent")) {
      return;
    }

    const agent = await authenticateAgent(request);
    if (!agent) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    (request as typeof request & { agent: typeof agent }).agent = agent;
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/store")) {
      return;
    }

    return requireStoreAuth(request, reply);
  });

  app.get("/store/me", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const store = await prisma.store.findUnique({
      where: { id: storeId },
    });

    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    return {
      id: store.id,
      name: store.name,
      slug: store.slug,
      email: store.email,
      isActive: store.isActive,
    };
  });

  app.get("/store/delivery-areas", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const areas = await prisma.deliveryArea.findMany({
      where: { storeId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return areas.map((area) => ({
      id: area.id,
      name: area.name,
      feeCents: area.feeCents,
      isActive: area.isActive,
      sortOrder: area.sortOrder,
      createdAt: area.createdAt,
      updatedAt: area.updatedAt,
    }));
  });

  app.post("/store/delivery-areas", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const bodySchema = z.object({
      name: z.string().min(1),
      feeCents: z.number().int().nonnegative(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    });

    const { name, feeCents, isActive, sortOrder } = bodySchema.parse(
      request.body
    );

    const area = await prisma.deliveryArea.create({
      data: {
        storeId,
        name,
        feeCents,
        isActive: isActive ?? true,
        sortOrder: sortOrder ?? 0,
      },
    });

    return reply.status(201).send({
      id: area.id,
      name: area.name,
      feeCents: area.feeCents,
      isActive: area.isActive,
      sortOrder: area.sortOrder,
      createdAt: area.createdAt,
      updatedAt: area.updatedAt,
    });
  });

  app.patch("/store/delivery-areas/:id", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({
      name: z.string().min(1).optional(),
      feeCents: z.number().int().nonnegative().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    });

    const { id } = paramsSchema.parse(request.params);
    const { name, feeCents, isActive, sortOrder } = bodySchema.parse(
      request.body
    );

    const area = await prisma.deliveryArea.findFirst({
      where: { id, storeId },
    });

    if (!area) {
      return reply.status(404).send({ message: "Delivery area not found" });
    }

    const updated = await prisma.deliveryArea.update({
      where: { id },
      data: {
        name: name ?? area.name,
        feeCents: feeCents ?? area.feeCents,
        isActive: isActive ?? area.isActive,
        sortOrder: sortOrder ?? area.sortOrder,
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      feeCents: updated.feeCents,
      isActive: updated.isActive,
      sortOrder: updated.sortOrder,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  });

  app.delete("/store/delivery-areas/:id", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const area = await prisma.deliveryArea.findFirst({
      where: { id, storeId },
    });

    if (!area) {
      return reply.status(404).send({ message: "Delivery area not found" });
    }

    await prisma.deliveryArea.delete({ where: { id } });
    return reply.status(204).send();
  });

  app.get("/store/settings/hours", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const hours = await prisma.storeHours.findUnique({
      where: { storeId },
    });

    if (!hours) {
      return reply.send(defaultHours);
    }

    return reply.send({
      timezone: hours.timezone,
      monOpen: hours.monOpen,
      monClose: hours.monClose,
      monEnabled: hours.monEnabled,
      tueOpen: hours.tueOpen,
      tueClose: hours.tueClose,
      tueEnabled: hours.tueEnabled,
      wedOpen: hours.wedOpen,
      wedClose: hours.wedClose,
      wedEnabled: hours.wedEnabled,
      thuOpen: hours.thuOpen,
      thuClose: hours.thuClose,
      thuEnabled: hours.thuEnabled,
      friOpen: hours.friOpen,
      friClose: hours.friClose,
      friEnabled: hours.friEnabled,
      satOpen: hours.satOpen,
      satClose: hours.satClose,
      satEnabled: hours.satEnabled,
      sunOpen: hours.sunOpen,
      sunClose: hours.sunClose,
      sunEnabled: hours.sunEnabled,
      isOpenNowOverride: hours.isOpenNowOverride,
      closedMessage: hours.closedMessage,
    });
  });

  app.put("/store/settings/hours", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
    const bodySchema = z.object({
      timezone: z.string().min(1).optional(),
      monOpen: hhmm.nullable().optional(),
      monClose: hhmm.nullable().optional(),
      monEnabled: z.boolean().optional(),
      tueOpen: hhmm.nullable().optional(),
      tueClose: hhmm.nullable().optional(),
      tueEnabled: z.boolean().optional(),
      wedOpen: hhmm.nullable().optional(),
      wedClose: hhmm.nullable().optional(),
      wedEnabled: z.boolean().optional(),
      thuOpen: hhmm.nullable().optional(),
      thuClose: hhmm.nullable().optional(),
      thuEnabled: z.boolean().optional(),
      friOpen: hhmm.nullable().optional(),
      friClose: hhmm.nullable().optional(),
      friEnabled: z.boolean().optional(),
      satOpen: hhmm.nullable().optional(),
      satClose: hhmm.nullable().optional(),
      satEnabled: z.boolean().optional(),
      sunOpen: hhmm.nullable().optional(),
      sunClose: hhmm.nullable().optional(),
      sunEnabled: z.boolean().optional(),
      isOpenNowOverride: z
        .enum(["AUTO", "FORCE_OPEN", "FORCE_CLOSED"])
        .optional(),
      closedMessage: z.string().nullable().optional(),
    });

    const payload = bodySchema.parse(request.body);

    const createData: Prisma.StoreHoursUncheckedCreateInput = {
      storeId,
      timezone: payload.timezone ?? defaultHours.timezone,
      monOpen: payload.monOpen ?? null,
      monClose: payload.monClose ?? null,
      monEnabled: payload.monEnabled ?? false,
      tueOpen: payload.tueOpen ?? null,
      tueClose: payload.tueClose ?? null,
      tueEnabled: payload.tueEnabled ?? false,
      wedOpen: payload.wedOpen ?? null,
      wedClose: payload.wedClose ?? null,
      wedEnabled: payload.wedEnabled ?? false,
      thuOpen: payload.thuOpen ?? null,
      thuClose: payload.thuClose ?? null,
      thuEnabled: payload.thuEnabled ?? false,
      friOpen: payload.friOpen ?? null,
      friClose: payload.friClose ?? null,
      friEnabled: payload.friEnabled ?? false,
      satOpen: payload.satOpen ?? null,
      satClose: payload.satClose ?? null,
      satEnabled: payload.satEnabled ?? false,
      sunOpen: payload.sunOpen ?? null,
      sunClose: payload.sunClose ?? null,
      sunEnabled: payload.sunEnabled ?? false,
      isOpenNowOverride: payload.isOpenNowOverride ?? OpenOverride.AUTO,
      closedMessage: payload.closedMessage ?? null,
    };

    const updateData: Prisma.StoreHoursUncheckedUpdateInput = {
      timezone: payload.timezone ?? undefined,
      monOpen: payload.monOpen ?? null,
      monClose: payload.monClose ?? null,
      monEnabled: payload.monEnabled ?? undefined,
      tueOpen: payload.tueOpen ?? null,
      tueClose: payload.tueClose ?? null,
      tueEnabled: payload.tueEnabled ?? undefined,
      wedOpen: payload.wedOpen ?? null,
      wedClose: payload.wedClose ?? null,
      wedEnabled: payload.wedEnabled ?? undefined,
      thuOpen: payload.thuOpen ?? null,
      thuClose: payload.thuClose ?? null,
      thuEnabled: payload.thuEnabled ?? undefined,
      friOpen: payload.friOpen ?? null,
      friClose: payload.friClose ?? null,
      friEnabled: payload.friEnabled ?? undefined,
      satOpen: payload.satOpen ?? null,
      satClose: payload.satClose ?? null,
      satEnabled: payload.satEnabled ?? undefined,
      sunOpen: payload.sunOpen ?? null,
      sunClose: payload.sunClose ?? null,
      sunEnabled: payload.sunEnabled ?? undefined,
      isOpenNowOverride: payload.isOpenNowOverride ?? undefined,
      closedMessage: payload.closedMessage ?? null,
    };

    const hours = await prisma.storeHours.upsert({
      where: { storeId },
      create: createData,
      update: updateData,
    });

    return reply.send({
      timezone: hours.timezone,
      monOpen: hours.monOpen,
      monClose: hours.monClose,
      monEnabled: hours.monEnabled,
      tueOpen: hours.tueOpen,
      tueClose: hours.tueClose,
      tueEnabled: hours.tueEnabled,
      wedOpen: hours.wedOpen,
      wedClose: hours.wedClose,
      wedEnabled: hours.wedEnabled,
      thuOpen: hours.thuOpen,
      thuClose: hours.thuClose,
      thuEnabled: hours.thuEnabled,
      friOpen: hours.friOpen,
      friClose: hours.friClose,
      friEnabled: hours.friEnabled,
      satOpen: hours.satOpen,
      satClose: hours.satClose,
      satEnabled: hours.satEnabled,
      sunOpen: hours.sunOpen,
      sunClose: hours.sunClose,
      sunEnabled: hours.sunEnabled,
      isOpenNowOverride: hours.isOpenNowOverride,
      closedMessage: hours.closedMessage,
    });
  });

  app.get("/store/settings/payment", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const settings = await prisma.storePaymentSettings.findUnique({
      where: { storeId },
    });

    if (!settings) {
      return reply.send({
        acceptPix: true,
        acceptCash: true,
        acceptCard: true,
        pixKey: null,
        pixName: null,
        pixBank: null,
      });
    }

    return reply.send({
      acceptPix: settings.acceptPix,
      acceptCash: settings.acceptCash,
      acceptCard: settings.acceptCard,
      pixKey: settings.pixKey,
      pixName: settings.pixName,
      pixBank: settings.pixBank,
    });
  });

  app.put("/store/settings/payment", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const bodySchema = z.object({
      acceptPix: z.boolean().optional(),
      acceptCash: z.boolean().optional(),
      acceptCard: z.boolean().optional(),
      pixKey: z.string().nullable().optional(),
      pixName: z.string().nullable().optional(),
      pixBank: z.string().nullable().optional(),
    });

    const payload = bodySchema.parse(request.body);

    const settings = await prisma.storePaymentSettings.upsert({
      where: { storeId },
      create: {
        storeId,
        acceptPix: payload.acceptPix ?? true,
        acceptCash: payload.acceptCash ?? true,
        acceptCard: payload.acceptCard ?? true,
        pixKey: payload.pixKey ?? null,
        pixName: payload.pixName ?? null,
        pixBank: payload.pixBank ?? null,
      },
      update: {
        acceptPix: payload.acceptPix ?? undefined,
        acceptCash: payload.acceptCash ?? undefined,
        acceptCard: payload.acceptCard ?? undefined,
        pixKey: payload.pixKey ?? null,
        pixName: payload.pixName ?? null,
        pixBank: payload.pixBank ?? null,
      },
    });

    return reply.send({
      acceptPix: settings.acceptPix,
      acceptCash: settings.acceptCash,
      acceptCard: settings.acceptCard,
      pixKey: settings.pixKey,
      pixName: settings.pixName,
      pixBank: settings.pixBank,
    });
  });

  app.get("/store/orders/stream", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    reply.hijack();
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("Keep-Alive", "timeout=120");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders?.();
    reply.raw.write("retry: 10000\n");
    reply.raw.write(":ok\n\n");
    reply.raw.setTimeout(0);

    const clients = orderStreamClients.get(storeId) ?? new Set();
    clients.add(reply);
    orderStreamClients.set(storeId, clients);
    const pingIntervalMs = 15000 + Math.floor(Math.random() * 10000);
    const pingInterval = setInterval(() => {
      try {
        reply.raw.write("event: ping\ndata: {}\n\n");
      } catch {
        const activeClients = orderStreamClients.get(storeId);
        activeClients?.delete(reply);
        const ping = orderStreamPingers.get(reply);
        if (ping) {
          clearInterval(ping);
          orderStreamPingers.delete(reply);
        }
      }
    }, pingIntervalMs);
    orderStreamPingers.set(reply, pingInterval);

    request.raw.on("close", () => {
      const activeClients = orderStreamClients.get(storeId);
      if (!activeClients) {
        return;
      }
      activeClients.delete(reply);
      if (activeClients.size === 0) {
        orderStreamClients.delete(storeId);
      }
      const ping = orderStreamPingers.get(reply);
      if (ping) {
        clearInterval(ping);
        orderStreamPingers.delete(reply);
      }
    });

    return reply.raw;
  });

  app.get("/store/orders", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const querySchema = z.object({
      status: z.enum(["NEW", "PRINTING", "PRINTED"]).optional(),
      since: z.string().datetime().optional(),
    });

    const { status, since } = querySchema.parse(request.query);

    const orders = await prisma.order.findMany({
      where: {
        storeId,
        status,
        createdAt: since ? { gt: new Date(since) } : undefined,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return orders.map((order) => ({
      id: order.id,
      shortId: order.id.slice(0, 6),
      customerName: order.customerName,
      status: order.status,
      fulfillmentType: order.fulfillmentType,
      total: order.total.toNumber(),
      deliveryFeeCents: order.deliveryFeeCents,
      paymentMethod: order.paymentMethod,
      changeForCents: order.changeForCents,
      createdAt: order.createdAt,
    }));
  });

  app.get("/store/categories", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const categories = await prisma.category.findMany({
      where: { storeId },
      orderBy: { createdAt: "asc" },
    });

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      active: category.active,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    }));
  });

  app.post("/store/categories", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const bodySchema = z.object({
      name: z.string().min(1),
      active: z.boolean().optional(),
    });

    const { name, active } = bodySchema.parse(request.body);

    const category = await prisma.category.create({
      data: {
        name,
        active: active ?? true,
        storeId,
      },
    });

    return reply.status(201).send({
      id: category.id,
      name: category.name,
      active: category.active,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    });
  });

  app.patch("/store/categories/:id", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({
      name: z.string().min(1).optional(),
      active: z.boolean().optional(),
    });

    const { id } = paramsSchema.parse(request.params);
    const { name, active } = bodySchema.parse(request.body);

    if (!name && active === undefined) {
      return reply.status(400).send({ message: "No changes provided" });
    }

    const category = await prisma.category.findFirst({
      where: { id, storeId },
    });

    if (!category) {
      return reply.status(404).send({ message: "Category not found" });
    }

    const updated = await prisma.category.update({
      where: { id },
      data: {
        name: name ?? category.name,
        active: active ?? category.active,
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      active: updated.active,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  });

  app.get("/store/products", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const products = await prisma.product.findMany({
      where: {
        category: {
          storeId,
        },
      },
      include: {
        category: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return products.map((product) => ({
      id: product.id,
      name: product.name,
      price: product.price.toNumber(),
      active: product.active,
      categoryId: product.categoryId,
      categoryName: product.category.name,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    }));
  });

  app.post("/store/products", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const bodySchema = z.object({
      name: z.string().min(1),
      categoryId: z.string().uuid(),
      price: z.number().nonnegative(),
      active: z.boolean().optional(),
    });

    const { name, categoryId, price, active } = bodySchema.parse(request.body);

    const category = await prisma.category.findFirst({
      where: { id: categoryId, storeId },
    });

    if (!category) {
      return reply.status(404).send({ message: "Category not found" });
    }

    const product = await prisma.product.create({
      data: {
        name,
        price,
        active: active ?? true,
        categoryId,
      },
    });

    return reply.status(201).send({
      id: product.id,
      name: product.name,
      price: product.price.toNumber(),
      active: product.active,
      categoryId: product.categoryId,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    });
  });

  app.patch("/store/products/:id", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({
      name: z.string().min(1).optional(),
      price: z.number().nonnegative().optional(),
      categoryId: z.string().uuid().optional(),
      active: z.boolean().optional(),
    });

    const { id } = paramsSchema.parse(request.params);
    const { name, price, categoryId, active } = bodySchema.parse(request.body);

    if (!name && price === undefined && !categoryId && active === undefined) {
      return reply.status(400).send({ message: "No changes provided" });
    }

    const product = await prisma.product.findFirst({
      where: {
        id,
        category: {
          storeId,
        },
      },
    });

    if (!product) {
      return reply.status(404).send({ message: "Product not found" });
    }

    if (categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: categoryId, storeId },
      });
      if (!category) {
        return reply.status(404).send({ message: "Category not found" });
      }
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        name: name ?? product.name,
        price: price ?? product.price,
        active: active ?? product.active,
        categoryId: categoryId ?? product.categoryId,
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      price: updated.price.toNumber(),
      active: updated.active,
      categoryId: updated.categoryId,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  });

  app.get("/store/products/:id/option-groups", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const product = await prisma.product.findFirst({
      where: { id, category: { storeId } },
      include: {
        optionGroups: {
          include: {
            items: true,
          },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
    });

    if (!product) {
      return reply.status(404).send({ message: "Product not found" });
    }

    return reply.send(
      product.optionGroups.map((group) => ({
        id: group.id,
        productId: group.productId,
        name: group.name,
        type: group.type,
        required: group.required,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        sortOrder: group.sortOrder,
        items: group.items
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
          .map((item) => ({
            id: item.id,
            groupId: item.groupId,
            name: item.name,
            priceDeltaCents: item.priceDeltaCents,
            isActive: item.isActive,
            sortOrder: item.sortOrder,
          })),
      }))
    );
  });

  app.post("/store/products/:id/option-groups", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({
      name: z.string().min(1),
      type: z.enum(["SINGLE", "MULTI"]),
      required: z.boolean().optional(),
      minSelect: z.number().int().nonnegative().optional(),
      maxSelect: z.number().int().nonnegative().optional(),
      sortOrder: z.number().int().optional(),
    });

    const { id } = paramsSchema.parse(request.params);
    const payload = bodySchema.parse(request.body);

    const product = await prisma.product.findFirst({
      where: { id, category: { storeId } },
    });

    if (!product) {
      return reply.status(404).send({ message: "Product not found" });
    }

    const normalizedRules = normalizeOptionGroupRules({
      type: payload.type,
      required: payload.required ?? false,
      minSelect: payload.minSelect ?? 0,
      maxSelect: payload.maxSelect ?? 0,
    });

    if (!normalizedRules.ok) {
      return reply.status(400).send({ message: normalizedRules.message });
    }

    const group = await prisma.productOptionGroup.create({
      data: {
        productId: product.id,
        name: payload.name,
        type: payload.type,
        required: payload.required ?? false,
        minSelect: normalizedRules.minSelect,
        maxSelect: normalizedRules.maxSelect,
        sortOrder: payload.sortOrder ?? 0,
      },
    });

    return reply.status(201).send({
      id: group.id,
      productId: group.productId,
      name: group.name,
      type: group.type,
      required: group.required,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      sortOrder: group.sortOrder,
    });
  });

  app.put("/store/option-groups/:groupId", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ groupId: z.string().uuid() });
    const bodySchema = z.object({
      name: z.string().min(1).optional(),
      type: z.enum(["SINGLE", "MULTI"]).optional(),
      required: z.boolean().optional(),
      minSelect: z.number().int().nonnegative().optional(),
      maxSelect: z.number().int().nonnegative().optional(),
      sortOrder: z.number().int().optional(),
    });

    const { groupId } = paramsSchema.parse(request.params);
    const payload = bodySchema.parse(request.body);

    const group = await prisma.productOptionGroup.findFirst({
      where: {
        id: groupId,
        product: {
          category: { storeId },
        },
      },
    });

    if (!group) {
      return reply.status(404).send({ message: "Option group not found" });
    }

    const updatedType = payload.type ?? group.type;
    const updatedRequired = payload.required ?? group.required;
    const updatedMin = payload.minSelect ?? group.minSelect;
    const updatedMax = payload.maxSelect ?? group.maxSelect;
    const normalizedRules = normalizeOptionGroupRules({
      type: updatedType,
      required: updatedRequired,
      minSelect: updatedMin,
      maxSelect: updatedMax,
    });

    if (!normalizedRules.ok) {
      return reply.status(400).send({ message: normalizedRules.message });
    }

    const updated = await prisma.productOptionGroup.update({
      where: { id: groupId },
      data: {
        name: payload.name ?? group.name,
        type: updatedType,
        required: updatedRequired,
        minSelect: normalizedRules.minSelect,
        maxSelect: normalizedRules.maxSelect,
        sortOrder: payload.sortOrder ?? group.sortOrder,
      },
    });

    return reply.send({
      id: updated.id,
      productId: updated.productId,
      name: updated.name,
      type: updated.type,
      required: updated.required,
      minSelect: updated.minSelect,
      maxSelect: updated.maxSelect,
      sortOrder: updated.sortOrder,
    });
  });

  app.delete("/store/option-groups/:groupId", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ groupId: z.string().uuid() });
    const { groupId } = paramsSchema.parse(request.params);

    const group = await prisma.productOptionGroup.findFirst({
      where: {
        id: groupId,
        product: {
          category: { storeId },
        },
      },
    });

    if (!group) {
      return reply.status(404).send({ message: "Option group not found" });
    }

    await prisma.productOptionGroup.delete({ where: { id: groupId } });
    return reply.status(204).send();
  });

  app.get("/store/option-groups/:groupId/items", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ groupId: z.string().uuid() });
    const { groupId } = paramsSchema.parse(request.params);

    const group = await prisma.productOptionGroup.findFirst({
      where: {
        id: groupId,
        product: { category: { storeId } },
      },
    });

    if (!group) {
      return reply.status(404).send({ message: "Option group not found" });
    }

    const items = await prisma.productOptionItem.findMany({
      where: { groupId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return reply.send(
      items.map((item) => ({
        id: item.id,
        groupId: item.groupId,
        name: item.name,
        priceDeltaCents: item.priceDeltaCents,
        isActive: item.isActive,
        sortOrder: item.sortOrder,
      }))
    );
  });

  app.post("/store/option-groups/:groupId/items", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ groupId: z.string().uuid() });
    const bodySchema = z.object({
      name: z.string().min(1),
      priceDeltaCents: z.number().int().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    });

    const { groupId } = paramsSchema.parse(request.params);
    const payload = bodySchema.parse(request.body);

    const group = await prisma.productOptionGroup.findFirst({
      where: {
        id: groupId,
        product: { category: { storeId } },
      },
    });

    if (!group) {
      return reply.status(404).send({ message: "Option group not found" });
    }

    const item = await prisma.productOptionItem.create({
      data: {
        groupId,
        name: payload.name,
        priceDeltaCents: payload.priceDeltaCents ?? 0,
        isActive: payload.isActive ?? true,
        sortOrder: payload.sortOrder ?? 0,
      },
    });

    return reply.status(201).send({
      id: item.id,
      groupId: item.groupId,
      name: item.name,
      priceDeltaCents: item.priceDeltaCents,
      isActive: item.isActive,
      sortOrder: item.sortOrder,
    });
  });

  app.put(
    "/store/option-groups/:groupId/items/:itemId",
    async (request, reply) => {
      const storeId = request.storeId;
      if (!storeId) {
        return reply.status(401).send({ message: "Unauthorized" });
      }

      const paramsSchema = z.object({
        groupId: z.string().uuid(),
        itemId: z.string().uuid(),
      });
      const bodySchema = z.object({
        name: z.string().min(1).optional(),
        priceDeltaCents: z.number().int().optional(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
      });

      const { groupId, itemId } = paramsSchema.parse(request.params);
      const payload = bodySchema.parse(request.body);

      const group = await prisma.productOptionGroup.findFirst({
        where: {
          id: groupId,
          product: { category: { storeId } },
        },
      });

      if (!group) {
        return reply.status(404).send({ message: "Option group not found" });
      }

      const item = await prisma.productOptionItem.findFirst({
        where: { id: itemId, groupId },
      });

      if (!item) {
        return reply.status(404).send({ message: "Option item not found" });
      }

      const updated = await prisma.productOptionItem.update({
        where: { id: itemId },
        data: {
          name: payload.name ?? item.name,
          priceDeltaCents: payload.priceDeltaCents ?? item.priceDeltaCents,
          isActive: payload.isActive ?? item.isActive,
          sortOrder: payload.sortOrder ?? item.sortOrder,
        },
      });

      return reply.send({
        id: updated.id,
        groupId: updated.groupId,
        name: updated.name,
        priceDeltaCents: updated.priceDeltaCents,
        isActive: updated.isActive,
        sortOrder: updated.sortOrder,
      });
    }
  );

  app.delete(
    "/store/option-groups/:groupId/items/:itemId",
    async (request, reply) => {
      const storeId = request.storeId;
      if (!storeId) {
        return reply.status(401).send({ message: "Unauthorized" });
      }

      const paramsSchema = z.object({
        groupId: z.string().uuid(),
        itemId: z.string().uuid(),
      });
      const { groupId, itemId } = paramsSchema.parse(request.params);

      const group = await prisma.productOptionGroup.findFirst({
        where: {
          id: groupId,
          product: { category: { storeId } },
        },
      });

      if (!group) {
        return reply.status(404).send({ message: "Option group not found" });
      }

      const item = await prisma.productOptionItem.findFirst({
        where: { id: itemId, groupId },
      });

      if (!item) {
        return reply.status(404).send({ message: "Option item not found" });
      }

      await prisma.productOptionItem.delete({ where: { id: itemId } });
      return reply.status(204).send();
    }
  );

  app.get("/store/orders/:id", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const order = await prisma.order.findFirst({
      where: {
        id,
        storeId,
      },
      include: {
        items: {
          include: {
            product: true,
            options: true,
          },
        },
        deliveryArea: true,
      },
    });

    if (!order) {
      return reply.status(404).send({ message: "Order not found" });
    }

    return {
      id: order.id,
      shortId: order.id.slice(0, 6),
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      fulfillmentType: order.fulfillmentType,
      notes: order.notes,
      addressLine: order.addressLine,
      addressNumber: order.addressNumber,
      addressNeighborhood: order.addressNeighborhood,
      addressCity: order.addressCity,
      addressReference: order.addressReference,
      deliveryArea: order.deliveryArea
        ? {
            id: order.deliveryArea.id,
            name: order.deliveryArea.name,
            feeCents: order.deliveryArea.feeCents,
          }
        : null,
      deliveryFeeCents: order.deliveryFeeCents,
      paymentMethod: order.paymentMethod,
      changeForCents: order.changeForCents,
      paidStatus: order.paidStatus,
      status: order.status,
      total: order.total.toNumber(),
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.product.name,
        quantity: item.quantity,
        unitPrice: item.unitPriceCents / 100,
        notes: item.notes,
        options: item.options.map((option) => ({
          id: option.id,
          groupName: option.groupName,
          itemName: option.itemName,
          priceDeltaCents: option.priceDeltaCents,
        })),
      })),
    };
  });

  app.post("/store/orders/:id/reprint", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const order = await prisma.order.findFirst({
      where: {
        id,
        storeId,
      },
    });

    if (!order) {
      return reply.status(404).send({ message: "Order not found" });
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { status: "NEW" },
    });

    sendOrderStreamEvent(storeId, "order.updated", {
      id: updated.id,
      createdAt: updated.createdAt,
      status: updated.status,
      totalCents: Math.round(updated.total.toNumber() * 100),
      customerName: updated.customerName,
      deliveryType: updated.fulfillmentType,
      storeId,
    });

    return {
      id: updated.id,
      status: updated.status,
      total: updated.total.toNumber(),
    };
  });

  app.patch("/store/orders/:id/printing", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const bodySchema = z.object({}).optional();
    bodySchema.parse(request.body ?? {});

    const order = await prisma.order.findFirst({
      where: {
        id,
        storeId,
      },
    });

    if (!order) {
      return reply.status(404).send({ message: "Order not found" });
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { status: "PRINTING" },
    });

    sendOrderStreamEvent(storeId, "order.updated", {
      id: updated.id,
      createdAt: updated.createdAt,
      status: updated.status,
      totalCents: Math.round(updated.total.toNumber() * 100),
      customerName: updated.customerName,
      deliveryType: updated.fulfillmentType,
      storeId,
    });

    return {
      id: updated.id,
      shortId: updated.id.slice(0, 6),
      customerName: updated.customerName,
      status: updated.status,
      fulfillmentType: updated.fulfillmentType,
      total: updated.total.toNumber(),
      createdAt: updated.createdAt,
    };
  });

  app.get("/agent/orders", async (request) => {
    const querySchema = z.object({
      status: z.enum(["NEW", "PRINTING", "PRINTED"]).optional(),
    });

    const { status } = querySchema.parse(request.query);
    const agent = (request as typeof request & { agent: { storeId: string } })
      .agent;

    const orders = await prisma.order.findMany({
      where: {
        storeId: agent.storeId,
        status: status ?? "NEW",
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return orders.map((order) => ({
      id: order.id,
      status: order.status,
      total: order.total.toNumber(),
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.product.name,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        notes: item.notes,
      })),
    }));
  });

  app.patch("/agent/orders/:id", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({
      status: z.enum(["NEW", "PRINTING", "PRINTED"]),
    });

    const { id } = paramsSchema.parse(request.params);
    const { status } = bodySchema.parse(request.body);
    const agent = (request as typeof request & { agent: { storeId: string } })
      .agent;

    const order = await prisma.order.findFirst({
      where: {
        id,
        storeId: agent.storeId,
      },
    });

    if (!order) {
      return reply.status(404).send({ message: "Order not found" });
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { status },
    });

    sendOrderStreamEvent(agent.storeId, "order.updated", {
      id: updated.id,
      createdAt: updated.createdAt,
      status: updated.status,
      totalCents: Math.round(updated.total.toNumber() * 100),
      customerName: updated.customerName,
      deliveryType: updated.fulfillmentType,
      storeId: agent.storeId,
    });

    return {
      id: updated.id,
      status: updated.status,
      total: updated.total.toNumber(),
    };
  });

  app.get("/agent/orders/:id/pdf", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const agent = (request as typeof request & { agent: { storeId: string } })
      .agent;

    const order = await prisma.order.findFirst({
      where: {
        id,
        storeId: agent.storeId,
      },
      include: {
        store: true,
        items: {
          include: {
            product: true,
            options: true,
          },
        },
      },
    });

    if (!order) {
      return reply.status(404).send({ message: "Order not found" });
    }

    const pdf = buildOrderPdf(order);
    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `inline; filename=order-${order.id}.pdf`
    );

    return reply.send(pdf);
  });

  app.post("/agent/rotate-agent-token", async (request) => {
    const agent = (request as typeof request & { agent: { id: string } }).agent;
    const token = generateToken();
    const tokenHash = hashToken(token);

    await prisma.agent.update({
      where: { id: agent.id },
      data: { tokenHash },
    });

    return { token };
  });
};

const start = async () => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is required");
  }

  await app.register(fastifyJwt, {
    secret: jwtSecret,
  });
  await app.register(fastifyCookie);
  const allowedOrigins = buildAllowedOrigins();
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      cb(null, allowedOrigins.has(origin));
    },
    credentials: true,
  });

  registerRoutes();

  app.ready((err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
    app.log.info("=== ROUTES ===");
    app.log.info("\n" + app.printRoutes());
  });

  const port = Number(process.env.PORT ?? 3000);
  try {
    await app.listen({ port, host: "0.0.0.0" });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
