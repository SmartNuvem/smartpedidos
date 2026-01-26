import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import cors from "@fastify/cors";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "./prisma";
import {
  authenticateAgent,
  generateToken,
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

const authenticateStore = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply.status(401).send({ message: "Unauthorized" });
  }

  const token = authHeader.slice("Bearer ".length);
  try {
    const payload = app.jwt.verify<{
      role?: string;
      storeId?: string;
    }>(token);
    if (payload.role !== "store" || !payload.storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }
    request.storeId = payload.storeId;
  } catch {
    return reply.status(401).send({ message: "Unauthorized" });
  }
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
            },
          },
        },
      },
    });

    if (!store || !store.isActive) {
      return reply.status(404).send({ message: "Store not found" });
    }

    return {
      store: {
        name: store.name,
        slug: store.slug,
      },
      categories: store.categories.map((category) => ({
        id: category.id,
        name: category.name,
        products: category.products.map((product) => ({
          id: product.id,
          name: product.name,
          priceCents: Math.round(product.price.toNumber() * 100),
          active: product.active,
        })),
      })),
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
      fulfillmentType: z.enum(["PICKUP", "DELIVERY"]),
      notes: z.string().min(1).optional(),
      address: addressSchema.optional(),
      items: z
        .array(
          z.object({
            productId: z.string().uuid(),
            quantity: z.number().int().positive(),
            notes: z.string().min(1).optional(),
          })
        )
        .min(1),
    });

    const { slug } = paramsSchema.parse(request.params);
    const { items, fulfillmentType, address, customerName, customerPhone, notes } =
      bodySchema.parse(request.body);

    if (fulfillmentType === "DELIVERY" && !address) {
      return reply
        .status(400)
        .send({ message: "Delivery address is required" });
    }

    const store = await prisma.store.findUnique({
      where: { slug },
    });

    if (!store || !store.isActive) {
      return reply.status(404).send({ message: "Store not found" });
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
      return {
        ...item,
        unitPriceCents,
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
    const deliveryFeeCents = 0;
    const totalCents = subtotalCents + deliveryFeeCents;
    const total = totalCents / 100;

    const order = await prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          storeId: store.id,
          status: "NEW",
          fulfillmentType,
          customerName,
          customerPhone,
          notes: notes ?? null,
          addressLine: fulfillmentType === "DELIVERY" ? address?.line : null,
          addressNumber: fulfillmentType === "DELIVERY" ? address?.number : null,
          addressNeighborhood:
            fulfillmentType === "DELIVERY" ? address?.neighborhood : null,
          addressCity: fulfillmentType === "DELIVERY" ? address?.city : null,
          addressReference:
            fulfillmentType === "DELIVERY" ? address?.reference : null,
          deliveryFeeCents,
          total,
        },
      });

      await tx.orderItem.createMany({
        data: normalizedItems.map((item) => ({
          orderId: createdOrder.id,
          productId: item!.productId,
          quantity: item!.quantity,
          unitPriceCents: item!.unitPriceCents,
          notes: item!.notes ?? null,
        })),
      });

      return createdOrder;
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

    return {
      token,
      store: {
        id: store.id,
        name: store.name,
        slug: store.slug,
      },
    };
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

    return authenticateStore(request, reply);
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

  app.get("/store/orders", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const querySchema = z.object({
      status: z.enum(["NEW", "PRINTING", "PRINTED"]).optional(),
    });

    const { status } = querySchema.parse(request.query);

    const orders = await prisma.order.findMany({
      where: {
        storeId,
        status,
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
      total: order.total.toNumber(),
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
          },
        },
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

    return {
      id: updated.id,
      status: updated.status,
      total: updated.total.toNumber(),
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
  await app.register(cors, {
    origin: true,
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
