import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    storeId?: string | null;
  }
}
