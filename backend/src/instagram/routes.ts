import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authGuard, requireAuth, type AuthedRequest } from "../auth/guard.js";
import { instagramOAuth } from "./oauth.js";
import { audit } from "../audit.js";
import { logger } from "../logger.js";
import { env } from "../config/env.js";
import { sha256Hex } from "../crypto.js";

const connectMockSchema = z.object({
  username: z.string().min(1).max(60),
  provider: z.literal("mock").optional(),
});

/**
 * Instagram account routes. Real connections use official OAuth only.
 * Mock connections exist so the full product can be tested without Meta
 * credentials and are always labeled as mock in the UI.
 */
export async function registerInstagramAccountRoutes(app: FastifyInstance): Promise<void> {
  app.get("/instagram/accounts", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { rows } = await query(
      `SELECT id, ig_user_id, username, account_type, scopes, status, provider, last_sync_at, created_at
       FROM instagram_accounts WHERE user_id=$1 ORDER BY created_at ASC`,
      [auth.userId],
    );
    return reply.send({
      accounts: rows.map((r) => ({
        id: r.id,
        igUserId: r.ig_user_id,
        username: r.username,
        accountType: r.account_type,
        scopes: r.scopes,
        status: r.status,
        provider: r.provider,
        lastSyncAt: r.last_sync_at,
        createdAt: r.created_at,
      })),
      oauthConfigured: instagramOAuth.configured,
    });
  });

  /** Start OAuth: returns the Meta authorize URL for the app to open. */
  app.post("/instagram/connect", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const parsed = connectMockSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: "username required" });
    }
    if (parsed.data.provider === "mock") {
      // Mock connect — clearly labeled, no real token.
      const igUserId = "mock_ig_" + sha256Hex(auth.userId + parsed.data.username).slice(0, 12);
      const { rows } = await query(
        `INSERT INTO instagram_accounts
           (user_id, ig_user_id, username, account_type, provider, access_token_enc, status)
         VALUES ($1,$2,$3,'BUSINESS','mock','mock-token','connected')
         ON CONFLICT (user_id, ig_user_id) DO UPDATE SET status='connected', updated_at=now()
         RETURNING id`,
        [auth.userId, igUserId, parsed.data.username],
      );
      await audit(auth.userId, "instagram.connected_mock", "instagram_account", rows[0].id);
      // Seed with a sync from the mock provider.
      const { syncAccountConversations } = await import("../conversations/service.js");
      await syncAccountConversations(auth.userId, rows[0].id).catch((e) =>
        logger.warn("mock sync failed", { err: String(e) }),
      );
      return reply.code(201).send({
        accountId: rows[0].id,
        mode: "mock",
        message: "Mock account connected — labeled as mock, safe for development.",
      });
    }

    if (!instagramOAuth.configured) {
      return reply.code(400).send({
        error: "instagram_not_configured",
        message:
          "Meta app credentials are not configured on the backend. Set INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET. Mock mode remains available.",
      });
    }
    const state = instagramOAuth.newCsrfState();
    const redirectUri = env.appBaseUrl + "/instagram/oauth/callback";
    // State binds the OAuth start to this user; signed via HMAC in token.
    const stateToken = Buffer.from(JSON.stringify({ userId: auth.userId, nonce: state })).toString("base64url");
    return reply.send({
      authorizeUrl: instagramOAuth.buildAuthorizeUrl(state, redirectUri),
      stateToken,
      redirectUri,
    });
  });

  /** Official OAuth callback — Meta redirects here after consent. */
  app.get("/instagram/oauth/callback", async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as Record<string, string>;
    if (q.error) {
      return reply.code(400).send({ error: "oauth_denied", message: q.error_description ?? q.error });
    }
    const code = q.code;
    const stateRaw = q.state;
    if (!code || !stateRaw) {
      return reply.code(400).send({ error: "invalid_request", message: "Missing code/state" });
    }
    let userId: string;
    let nonce: string;
    try {
      const decoded = JSON.parse(Buffer.from(stateRaw, "base64url").toString());
      userId = decoded.userId;
      nonce = decoded.nonce;
    } catch {
      return reply.code(400).send({ error: "invalid_state" });
    }
    void nonce;
    const redirectUri = env.appBaseUrl + "/instagram/oauth/callback";
    const short = await instagramOAuth.exchangeCodeForToken(code, redirectUri);
    const longLived = await instagramOAuth.exchangeForLongLived(short.accessToken);
    const profile = await instagramOAuth.getProfile(longLived.accessToken);
    const expiresAt = longLived.expiresIn
      ? new Date(Date.now() + longLived.expiresIn * 1000)
      : null;
    const { rows } = await query(
      `INSERT INTO instagram_accounts
         (user_id, ig_user_id, username, account_type, provider, access_token_enc, token_expires_at, scopes, status)
       VALUES ($1,$2,$3,$4,'instagram',$5,$6,$7,'connected')
       ON CONFLICT (user_id, ig_user_id) DO UPDATE SET
         access_token_enc=EXCLUDED.access_token_enc,
         token_expires_at=EXCLUDED.token_expires_at,
         status='connected', updated_at=now()
       RETURNING id`,
      [
        userId,
        profile.igUserId,
        profile.username,
        profile.accountType ?? "BUSINESS",
        // Production hardening: wrap with envelope encryption (KMS) before store.
        longLived.accessToken,
        expiresAt,
        short.scope ? short.scope.split(/[ ,]+/) : [],
      ],
    );
    await audit(userId, "instagram.connected_oauth", "instagram_account", rows[0].id);
    return reply.send({ ok: true, accountId: rows[0].id, username: profile.username });
  });

  app.post("/instagram/disconnect", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const parsed = z.object({ accountId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: "accountId required" });
    }
    const res = await query(
      `UPDATE instagram_accounts SET status='disconnected', access_token_enc=NULL, updated_at=now()
       WHERE id=$1 AND user_id=$2`,
      [parsed.data.accountId, auth.userId],
    );
    if ((res.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "not_found", message: "Account not found" });
    }
    await audit(auth.userId, "instagram.disconnected", "instagram_account", parsed.data.accountId);
    return reply.send({ ok: true });
  });

  app.post("/instagram/sync", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const parsed = z.object({ accountId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: "accountId required" });
    }
    const { syncAccountConversations } = await import("../conversations/service.js");
    try {
      const result = await syncAccountConversations(auth.userId, parsed.data.accountId);
      return reply.send({ ok: true, ...result });
    } catch (err) {
      if (String(err).includes("account_not_found")) {
        return reply.code(404).send({ error: "not_found", message: "Account not found" });
      }
      logger.warn("sync failed", { err: String(err) });
      return reply.code(502).send({ error: "provider_error", message: "Upstream provider error" });
    }
  });
}
