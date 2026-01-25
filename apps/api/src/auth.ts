import crypto from "node:crypto";
import { FastifyRequest } from "fastify";
import { prisma } from "./prisma";

export const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const generateToken = () => crypto.randomBytes(24).toString("hex");

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
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);
  return prisma.agent.findFirst({
    where: {
      tokenHash,
      active: true,
    },
    include: {
      store: true,
    },
  });
};
