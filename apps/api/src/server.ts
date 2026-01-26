import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import cors from "@fastify/cors";
import bcrypt from "bcrypt";
import { z } from "zod";
import { prisma } from "./prisma";
import {
  authenticateAgent,
  generateToken,
  hashToken,
} from "./auth";
import { buildOrderPdf } from "./pdf";

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
          include: {
            products: {
              where: { active: true },
            },
          },
        },
      },
    });

    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    return {
      id: store.id,
      name: store.name,
      slug: store.slug,
      categories: store.categories.map((category) => ({
        id: category.id,
        name: category.name,
        products: category.products.map((product) => ({
          id: product.id,
          name: product.name,
          price: product.price.toNumber(),
          active: product.active,
        })),
      })),
    };
  });

  app.post("/public/:slug/orders", async (request, reply) => {
    const paramsSchema = z.object({ slug: z.string() });
    const bodySchema = z.object({
      items: z
        .array(
          z.object({
            productId: z.string().uuid(),
            qty: z.number().int().positive(),
          })
        )
        .min(1),
    });

    const { slug } = paramsSchema.parse(request.params);
    const { items } = bodySchema.parse(request.body);

    const store = await prisma.store.findUnique({
      where: { slug },
    });

    if (!store) {
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

    const total = items.reduce((acc, item) => {
      const product = productMap.get(item.productId);
      if (!product) {
        return acc;
      }
      return acc + product.price.toNumber() * item.qty;
    }, 0);

    const order = await prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          storeId: store.id,
          status: "NEW",
          total,
        },
      });

      await tx.orderItem.createMany({
        data: items.map((item) => ({
          orderId: createdOrder.id,
          productId: item.productId,
          qty: item.qty,
          price: productMap.get(item.productId)!.price,
        })),
      });

      return createdOrder;
    });

    return reply.status(201).send({
      id: order.id,
      status: order.status,
      total: order.total.toNumber(),
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

  app.post("/admin/stores", async (request, reply) => {
    const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
    const headerToken = request.headers["x-bootstrap-token"];

    if (!bootstrapToken || headerToken !== bootstrapToken) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const bodySchema = z.object({
      name: z.string().min(1),
      slug: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(6),
    });

    const { name, slug, email, password } = bodySchema.parse(request.body);
    const passwordHash = await bcrypt.hash(password, 10);

    try {
      const store = await prisma.store.create({
        data: {
          name,
          slug,
          email,
          passwordHash,
          isActive: true,
        },
      });

      return reply.status(201).send({
        id: store.id,
        name: store.name,
        slug: store.slug,
        email: store.email,
        isActive: store.isActive,
        createdAt: store.createdAt,
        updatedAt: store.updatedAt,
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
      customerName: null,
      status: order.status,
      total: order.total.toNumber(),
      createdAt: order.createdAt,
    }));
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
      customerName: null,
      notes: null,
      status: order.status,
      total: order.total.toNumber(),
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.product.name,
        qty: item.qty,
        price: item.price.toNumber(),
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
        qty: item.qty,
        price: item.price.toNumber(),
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

  const port = Number(process.env.PORT ?? 3000);
  try {
    await app.listen({ port, host: "0.0.0.0" });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
