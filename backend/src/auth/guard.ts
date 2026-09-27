import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyJwt } from "./jwt.js";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";

export interface AuthContext {
  userId: string;
  sessionId?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export interface AuthedRequest extends FastifyRequest {
  auth: AuthContext;
}

export async function authGuard(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    await reply.code(401).send({ error: "unauthorized", message: "Missing bearer token" });
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  const payload = verifyJwt(token, env.jwtAccessSecret);
  if (!payload || payload.typ !== "access") {
    await reply.code(401).send({ error: "unauthorized", message: "Invalid or expired token" });
    return;
  }
  request.auth = { userId: payload.sub, sessionId: payload.sid };
}

/**
 * Returns the AuthContext set by authGuard. Throws 401 if the guard did not
 * run (misconfigured route), so handlers can use `auth.userId` directly.
 */
export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) {
    throw Object.assign(new Error("authGuard missing on route"), { statusCode: 401 });
  }
  return request.auth;
}
