import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { logger } from "../logger.js";
import { safeEqual, hmacSha256Hex } from "../crypto.js";
import { query } from "../db/pool.js";
import { audit } from "../audit.js";
import { notificationProvider } from "../notifications/provider.js";

declare module "fastify" {
  interface FastifyContextConfig {
    rawBody?: boolean;
  }
}

/**
 * Instagram webhook receiver (official Meta webhooks only).
 *
 * Verification: GET with hub.mode/hub.verify_token/hub.challenge.
 * Signature:    X-Hub-Signature-256 = sha256=<HMAC(appSecret, rawBody)>.
 *
 * Handled events: messages (new incoming DM) -> store message, queue AI draft
 * generation, push "AI reply ready" notification to the owner.
 */
export async function registerInstagramWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.get("/webhooks/instagram", async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as Record<string, string>;
    const mode = q["hub.mode"];
    const token = q["hub.verify_token"];
    const challenge = q["hub.challenge"];
    if (mode === "subscribe" && token && safeEqual(token, env.instagramWebhookVerifyToken)) {
      logger.info("instagram webhook verified");
      return reply.code(200).send(challenge);
    }
    return reply.code(403).send({ error: "forbidden", message: "Webhook verification failed" });
  });

  app.post(
    "/webhooks/instagram",
    {
      config: {
        // Capture raw body for signature validation.
        rawBody: true,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const signatureHeader = request.headers["x-hub-signature-256"];
      const raw = (request as unknown as { rawBody?: string }).rawBody ?? "";
      if (env.isProd && env.instagramAppSecret) {
        const expected = "sha256=" + hmacSha256Hex(env.instagramAppSecret, raw);
        if (
          typeof signatureHeader !== "string" ||
          !safeEqual(signatureHeader, expected)
        ) {
          return reply.code(401).send({ error: "invalid_signature" });
        }
      }

      type WebhookEntry = {
        id: string;
        time: number;
        messaging?: Array<{
          sender?: { id?: string };
          recipient?: { id?: string };
          message?: { mid?: string; text?: string; is_echo?: boolean };
        }>;
      };
      const body = request.body as
        | { object?: string; entry?: WebhookEntry[] }
        | undefined;

      if (body?.object !== "instagram") {
        return reply.code(200).send({ ok: true });
      }

      for (const entry of body.entry ?? []) {
        const igUserId = entry.id;
        for (const m of entry.messaging ?? []) {
          if (!m.message || m.message.is_echo) continue;
          const text = m.message.text ?? "";
          const senderId = m.sender?.id ?? "unknown";
          await handleIncomingDm(igUserId, senderId, m.message.mid ?? "unknown", text);
        }
      }
      // Always 200 quickly so Meta does not retry.
      return reply.code(200).send({ ok: true });
    },
  );
}

async function handleIncomingDm(
  igUserId: string,
  senderId: string,
  messageId: string,
  text: string,
): Promise<void> {
  try {
    const { rows } = await query<{ id: string; user_id: string; auto_reply_mode: string }>(
      `SELECT c.id, c.user_id, c.auto_reply_mode
       FROM conversations c
       JOIN instagram_accounts a ON a.id = c.ig_account_id
       WHERE a.ig_user_id = $1 AND c.external_conversation_id = $2
       LIMIT 1`,
      [igUserId, "dm_" + senderId],
    );
    const conv = rows[0];
    if (!conv) {
      logger.info("webhook message for unknown conversation", { igUserId });
      return;
    }
    await query(
      `INSERT INTO messages (conversation_id, ig_message_id, sender, text)
       VALUES ($1,$2,'them',$3)
       ON CONFLICT (ig_message_id) DO NOTHING`,
      [conv.id, messageId, text],
    );
    await query(
      "UPDATE conversations SET last_message_at=now(), last_message_preview=$2, unread_count=unread_count+1, updated_at=now() WHERE id=$1",
      [conv.id, text.slice(0, 80)],
    );
    await audit(conv.user_id, "instagram.message_received", "conversation", conv.id);
    if (conv.auto_reply_mode !== "off") {
      // Queue draft generation; the app polls or receives push when ready.
      const { rows: drafts } = await query<{ id: string }>(
        `INSERT INTO generation_history (user_id, conversation_id, reply_text, reply_mode, model)
         VALUES ($1,$2,'','draft_only','pending')
         RETURNING id`,
        [conv.user_id, conv.id],
      );
      void drafts;
    }
    await notificationProvider.sendToUser({
      userId: conv.user_id,
      title: "New Instagram DM",
      body: "ToneAI is preparing a suggested reply",
      data: { type: "new_dm", conversationId: conv.id },
    });
  } catch (err) {
    logger.error("webhook handling failed", { err: String(err) });
  }
}
