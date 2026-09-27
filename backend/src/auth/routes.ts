import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { query, withTransaction } from "../db/pool.js";
import { hashPassword, verifyPassword } from "./password.js";
import { signJwt, verifyJwt } from "./jwt.js";
import { env } from "../config/env.js";
import { logger } from "../logger.js";
import { sha256Hex, randomToken } from "../crypto.js";
import { authGuard, requireAuth, type AuthedRequest } from "./guard.js";
import { audit } from "../audit.js";

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(80).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({ refreshToken: z.string().min(10) });

function deviceLabel(request: FastifyRequest): string {
  const ua = request.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 120) : "unknown-device";
}

async function createSession(userId: string, device: string): Promise<string> {
  const refreshToken = randomToken(48);
  const expiresAt = new Date(Date.now() + env.refreshTokenTtl * 1000);
  await query(
    `INSERT INTO sessions (user_id, refresh_token_hash, device_label, expires_at)
     VALUES ($1,$2,$3,$4)`,
    [userId, sha256Hex(refreshToken), device, expiresAt],
  );
  return refreshToken;
}

function issueAccessToken(userId: string, sessionId: string): string {
  return signJwt(
    { sub: userId, typ: "access", sid: sessionId, exp: Math.floor(Date.now() / 1000) + env.accessTokenTtl },
    env.jwtAccessSecret,
  );
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/register", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: parsed.error.issues[0]?.message });
    }
    const { email, password, displayName } = parsed.data;
    const exists = await query("SELECT 1 FROM users WHERE email=$1", [email.toLowerCase()]);
    if (exists.rowCount && exists.rowCount > 0) {
      return reply.code(409).send({ error: "email_taken", message: "An account with this email already exists" });
    }
    const passwordHash = await hashPassword(password);
    const { rows } = await query<{ id: string; email: string; display_name: string | null }>(
      `INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id, email, display_name`,
      [email.toLowerCase(), passwordHash, displayName ?? null],
    );
    const user = rows[0];
    // Default tone profile
    await query("INSERT INTO tone_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [user.id]);
    await query(
      "INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [user.id],
    );
    const refreshToken = await createSession(user.id, deviceLabel(request));
    const accessToken = issueAccessToken(user.id, "");
    await audit(user.id, "auth.register");
    logger.info("user registered", { userId: user.id });
    return reply.code(201).send({ user: { id: user.id, email: user.email, displayName: user.display_name }, accessToken, refreshToken });
  });

  app.post("/auth/login", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: "Email and password required" });
    }
    const { email, password } = parsed.data;
    const { rows } = await query<{ id: string; email: string; password_hash: string; display_name: string | null }>(
      "SELECT id, email, password_hash, display_name FROM users WHERE email=$1",
      [email.toLowerCase()],
    );
    const user = rows[0];
    const ok = user ? await verifyPassword(password, user.password_hash) : false;
    if (!user || !ok) {
      return reply.code(401).send({ error: "invalid_credentials", message: "Invalid email or password" });
    }
    const refreshToken = await createSession(user.id, deviceLabel(request));
    const { rows: sess } = await query<{ id: string }>(
      "SELECT id FROM sessions WHERE refresh_token_hash=$1",
      [sha256Hex(refreshToken)],
    );
    const accessToken = issueAccessToken(user.id, sess[0]?.id ?? "");
    await audit(user.id, "auth.login");
    return reply.send({ user: { id: user.id, email: user.email, displayName: user.display_name }, accessToken, refreshToken });
  });

  app.post("/auth/refresh", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: "refreshToken required" });
    }
    const hash = sha256Hex(parsed.data.refreshToken);
    const { rows } = await query<{
      id: string;
      user_id: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      "SELECT id, user_id, expires_at, revoked_at FROM sessions WHERE refresh_token_hash=$1",
      [hash],
    );
    const session = rows[0];
    if (!session || session.revoked_at || new Date(session.expires_at).getTime() < Date.now()) {
      return reply.code(401).send({ error: "invalid_session", message: "Session expired; log in again" });
    }
    // Rotation: revoke old, issue new
    const newRefresh = randomToken(48);
    await withTransaction(async (client) => {
      await client.query(
        "UPDATE sessions SET revoked_at=now() WHERE id=$1",
        [session.id],
      );
      await client.query(
        `INSERT INTO sessions (user_id, refresh_token_hash, device_label, expires_at, rotated_from)
         VALUES ($1,$2,(SELECT device_label FROM sessions WHERE id=$3),$4,$3)`,
        [session.user_id, sha256Hex(newRefresh), session.id, new Date(Date.now() + env.refreshTokenTtl * 1000)],
      );
      await client.query(
        "UPDATE users SET updated_at=now() WHERE id=$1",
        [session.user_id],
      ).catch(() => {});
    });
    const { rows: sess } = await query<{ id: string }>(
      "SELECT id FROM sessions WHERE refresh_token_hash=$1",
      [sha256Hex(newRefresh)],
    );
    const accessToken = issueAccessToken(session.user_id, sess[0]?.id ?? "");
    return reply.send({ accessToken, refreshToken: newRefresh });
  });

  app.post("/auth/logout", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const parsed = refreshSchema.safeParse(request.body);
    if (parsed.success) {
      await query(
        "UPDATE sessions SET revoked_at=now() WHERE refresh_token_hash=$1 AND user_id=$2",
        [sha256Hex(parsed.data.refreshToken), auth.userId],
      );
    } else if (auth.sessionId) {
      await query("UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2", [auth.sessionId, auth.userId]);
    }
    await audit(auth.userId, "auth.logout");
    return reply.send({ ok: true });
  });

  app.post("/auth/logout-all", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    await query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [auth.userId]);
    await audit(auth.userId, "auth.logout_all");
    return reply.send({ ok: true });
  });

  app.get("/me", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { rows } = await query<{ id: string; email: string; display_name: string | null; created_at: Date }>(
      "SELECT id, email, display_name, created_at FROM users WHERE id=$1",
      [auth.userId],
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found", message: "User not found" });
    const u = rows[0];
    return reply.send({ user: { id: u.id, email: u.email, displayName: u.display_name, createdAt: u.created_at } });
  });

  app.delete("/me", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const parsed = z.object({ password: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: "Password confirmation required" });
    }
    const { rows } = await query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id=$1",
      [auth.userId],
    );
    if (!rows[0] || !(await verifyPassword(parsed.data.password, rows[0].password_hash))) {
      return reply.code(403).send({ error: "forbidden", message: "Password incorrect" });
    }
    // Cascade deletes all owned data (sessions, accounts, conversations, etc.)
    await query("DELETE FROM users WHERE id=$1", [auth.userId]);
    await audit(null, "auth.account_deleted");
    logger.info("account deleted", { userId: auth.userId });
    return reply.send({ ok: true });
  });
}
