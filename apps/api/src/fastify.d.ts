import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    storeId?: string | null;
    adminId?: string | null;
    agent?: {
      id: string;
      storeId: string;
      name: string;
      isActive: boolean;
    };
  }
}
