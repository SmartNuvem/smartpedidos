import crypto from "node:crypto";
import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./prisma";

export const generateAgentToken = () =>
  `agt_${crypto.randomBytes(32).toString("hex")}`;

export const maskToken = (token: string) => {
  if (!token.startsWith("agt_")) {
    return "agt_****";
  }

  const suffix = token.slice(-4);
  return `agt_****${suffix}`;
};

export const getAgentToken = (request: FastifyRequest) => {
  const header = request.headers["x-agent-token"];
  if (!header) {
    return null;
  }

  const token = Array.isArray(header) ? header[0] : header;
  if (!token || typeof token !== "string") {
    return null;
  }

  if (!token.startsWith("agt_")) {
    return null;
  }

  return token;
};

export const getBearerToken = (request: FastifyRequest) => {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }

  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token) {
    return null;
  }

  return token;
};

export const authenticateAgent = async (request: FastifyRequest) => {
  const token = getAgentToken(request);
  if (!token) {
    return null;
  }

  return prisma.agent.findFirst({
    where: {
      token,
      isActive: true,
    },
  });
};

export const requireAdmin = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const token = getBearerToken(request);
  if (!token) {
    return reply.status(401).send({ message: "Unauthorized" });
  }

  try {
    await request.jwtVerify();
    const { role, sub } = request.user ?? {};
    if (role !== "admin") {
      return reply.status(403).send({ message: "Forbidden" });
    }
    request.adminId = sub ?? null;
  } catch {
    return reply.status(401).send({ message: "Unauthorized" });
  }
};
