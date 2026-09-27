import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { query } from "./db/pool.js";
import { authGuard, requireAuth, type AuthedRequest } from "./auth/guard.js";
import { aiProvider } from "./ai/index.js";
import { instagramOAuth } from "./instagram/oauth.js";
import { env } from "./config/env.js";

/**
 * Developer/diagnostics endpoint. Returns ONLY redacted, non-secret status
 * information safe to display in the app's developer section.
 */
export async function registerDiagnosticsRoute(app: FastifyInstance): Promise<void> {
  app.get("/diagnostics", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    let dbOk = false;
    let latencyMs = -1;
    const started = Date.now();
    try {
      await query("SELECT 1");
      dbOk = true;
    } catch {
      dbOk = false;
    }
    latencyMs = Date.now() - started;

    const { rows: accounts } = await query(
      "SELECT provider, status, last_sync_at FROM instagram_accounts WHERE user_id=$1",
      [auth.userId],
    );
    const { rows: sessions } = await query<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL",
      [auth.userId],
    );

    return reply.send({
      diagnostics: {
        backendConnection: "ok",
        dbConnected: dbOk,
        dbLatencyMs: latencyMs,
        aiProvider: aiProvider.name,
        aiConfigured: aiProvider.name !== "mock-ai",
        instagramOAuthConfigured: instagramOAuth.configured,
        instagramAccounts: accounts.map((a) => ({
          provider: a.provider,
          status: a.status,
          lastSyncAt: a.last_sync_at,
        })),
        activeSessions: Number(sessions[0]?.n ?? 0),
        notificationProvider: notificationName(),
        apiVersion: "v1",
        serverTime: new Date().toISOString(),
        // Never expose: tokens, secrets, message content, other users' data.
      },
    });
  });
}

function notificationName(): string {
  return process.env.NOTIFICATION_PROVIDER ?? "noop";
}
void env;
