import "@fastify/jwt";
import type { JwtUser } from "./jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}
