import Fastify from "fastify";
import cors from "@fastify/cors";
import { PrismaClient, OrderStatus } from "@prisma/client";
import { z } from "zod";
import crypto from "node:crypto";
import PDFDocument from "pdfkit";

const prisma = new PrismaClient();
const server = Fastify({ logger: true });

await server.register(cors, { origin: true });

server.get("/health", async () => ({ status: "ok" }));

const menuParamsSchema = z.object({ slug: z.string().min(1) });

server.get("/public/:slug/menu", async (request, reply) => {
  const params = menuParamsSchema.parse(request.params);
  const store = await prisma.store.findUnique({
    where: { slug: params.slug },
  });

  if (!store) {
    return reply.code(404).send({ message: "Store not found" });
  }

  const categories = await prisma.category.findMany({
    where: { storeId: store.id },
    orderBy: { name: "asc" },
    include: {
      products: {
        where: { isActive: true },
        orderBy: { name: "asc" },
      },
    },
  });

  return {
    store: { id: store.id, name: store.name, slug: store.slug },
    categories,
  };
});

const createOrderSchema = z.object({
  customerName: z.string().min(1),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
        notes: z.string().optional(),
      })
    )
    .min(1),
});

server.post("/public/:slug/orders", async (request, reply) => {
  const params = menuParamsSchema.parse(request.params);
  const payload = createOrderSchema.parse(request.body);

  const store = await prisma.store.findUnique({
    where: { slug: params.slug },
  });

  if (!store) {
    return reply.code(404).send({ message: "Store not found" });
  }

  const productIds = payload.items.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, storeId: store.id, isActive: true },
  });

  const productMap = new Map(products.map((product) => [product.id, product]));

  for (const item of payload.items) {
    if (!productMap.has(item.productId)) {
      return reply
        .code(400)
        .send({ message: `Produto inválido: ${item.productId}` });
    }
  }

  const totalCents = payload.items.reduce((total, item) => {
    const product = productMap.get(item.productId)!;
    return total + product.priceCents * item.quantity;
  }, 0);

  const order = await prisma.order.create({
    data: {
      storeId: store.id,
      customerName: payload.customerName,
      notes: payload.notes,
      totalCents,
      items: {
        create: payload.items.map((item) => {
          const product = productMap.get(item.productId)!;
          return {
            productId: product.id,
            productName: product.name,
            quantity: item.quantity,
            unitPriceCents: product.priceCents,
            notes: item.notes,
          };
        }),
      },
    },
    include: { items: true },
  });

  return reply.code(201).send(order);
});

const agentTokenHeader = z
  .string()
  .optional()
  .transform((value) => value?.replace("Bearer ", ""));

server.addHook("preHandler", async (request, reply) => {
  if (!request.url.startsWith("/agent")) {
    return;
  }

  const headerValue = agentTokenHeader.parse(
    request.headers.authorization ?? request.headers["x-agent-token"]
  );

  if (!headerValue) {
    return reply.code(401).send({ message: "Token do agente ausente" });
  }

  const agent = await prisma.agent.findUnique({
    where: { token: headerValue },
    include: { store: true },
  });

  if (!agent) {
    return reply.code(401).send({ message: "Token do agente inválido" });
  }

  request.agent = agent;
});

declare module "fastify" {
  interface FastifyRequest {
    agent?: {
      id: string;
      name: string;
      token: string;
      storeId: string;
      store: { id: string; name: string; slug: string };
    };
  }
}

const listOrdersSchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
});

server.get("/agent/orders", async (request) => {
  const query = listOrdersSchema.parse(request.query);
  const agent = request.agent!;

  const status = query.status ?? OrderStatus.NEW;

  return prisma.order.findMany({
    where: { storeId: agent.storeId, status },
    include: { items: true },
    orderBy: { createdAt: "asc" },
  });
});

const updateOrderSchema = z.object({
  status: z.nativeEnum(OrderStatus),
});

server.patch("/agent/orders/:id", async (request, reply) => {
  const agent = request.agent!;
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const payload = updateOrderSchema.parse(request.body);

  const order = await prisma.order.findFirst({
    where: { id: params.id, storeId: agent.storeId },
  });

  if (!order) {
    return reply.code(404).send({ message: "Pedido não encontrado" });
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: payload.status },
    include: { items: true },
  });

  return updated;
});

server.get("/agent/orders/:id/pdf", async (request, reply) => {
  const agent = request.agent!;
  const params = z.object({ id: z.string().uuid() }).parse(request.params);

  const order = await prisma.order.findFirst({
    where: { id: params.id, storeId: agent.storeId },
    include: { items: true, store: true },
  });

  if (!order) {
    return reply.code(404).send({ message: "Pedido não encontrado" });
  }

  const doc = new PDFDocument({
    size: [226.77, 700],
    margin: 16,
  });

  reply
    .header("Content-Type", "application/pdf")
    .header("Content-Disposition", `inline; filename=pedido-${order.id}.pdf`);

  doc.pipe(reply.raw);

  doc.fontSize(14).text(order.store.name, { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Pedido: ${order.id.slice(0, 8)}`);
  doc.text(`Cliente: ${order.customerName}`);
  doc.text(`Status: ${order.status}`);
  doc.text(`Criado em: ${order.createdAt.toLocaleString("pt-BR")}`);

  if (order.notes) {
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Obs: ${order.notes}`);
  }

  doc.moveDown();
  doc.fontSize(11).text("Itens", { underline: true });
  doc.moveDown(0.5);

  order.items.forEach((item) => {
    doc.fontSize(10).text(
      `${item.quantity}x ${item.productName} - R$ ${(item.unitPriceCents / 100).toFixed(2)}`
    );
    if (item.notes) {
      doc.fontSize(9).text(`  • ${item.notes}`);
    }
  });

  doc.moveDown();
  doc.fontSize(12).text(`Total: R$ ${(order.totalCents / 100).toFixed(2)}`);
  doc.end();

  return reply;
});

server.post("/agent/rotate-agent-token", async (request) => {
  const agent = request.agent!;
  const newToken = crypto.randomBytes(24).toString("hex");

  const updated = await prisma.agent.update({
    where: { id: agent.id },
    data: { token: newToken },
  });

  return { token: updated.token };
});

const port = Number(process.env.PORT ?? 3333);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await server.listen({ port, host });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
