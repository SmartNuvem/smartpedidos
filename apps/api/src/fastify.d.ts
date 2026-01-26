import "fastify";
import "@fastify/jwt";

type JwtUser = {
  role?: string;
  storeId?: string;
  sub?: string;
};

declare module "fastify" {
  interface FastifyRequest {
    storeId?: string | null;
    adminId?: string | null;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}
