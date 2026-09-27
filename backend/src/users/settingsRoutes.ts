import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { query, withTransaction } from "../db/pool.js";
import { authGuard, requireAuth, type AuthedRequest } from "../auth/guard.js";
import { audit } from "../audit.js";
import { usage } from "../conversations/usage.js";
import { getTurbo, setTurbo } from "../automation/turbo.js";

const settingsSchema = z.object({
  notificationMode: z.enum(["all_dms", "ai_drafts_only", "important_only", "disabled"]).optional(),
  newDmEnabled: z.boolean().optional(),
  fcmToken: z.string().max(4096).optional(),
});

const ruleSchema = z.object({
  conversationId: z.string().uuid().optional(),
  igAccountId: z.string().uuid().optional(),
  ruleType: z.enum([
    "unknown_sender_never_auto",
    "sensitive_keywords_never_auto",
    "requires_facts_ask_user",
    "selected_person_draft",
    "auto_send_within_hours",
    "quiet_hours",
  ]),
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get("/settings", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { rows } = await query(
      "SELECT user_id, mode, new_dm_enabled, fcm_token, updated_at FROM notification_preferences WHERE user_id=$1",
      [auth.userId],
    );
    const r = rows[0];
    return reply.send({
      settings: {
        notificationMode: r?.mode ?? "ai_drafts_only",
        newDmEnabled: r?.new_dm_enabled ?? true,
        hasFcmToken: Boolean(r?.fcm_token),
        updatedAt: r?.updated_at,
      },
    });
  });

  app.put("/settings", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: parsed.error.issues[0]?.message });
    }
    const s = parsed.data;
    const { rows } = await query(
      `INSERT INTO notification_preferences (user_id, mode, new_dm_enabled, fcm_token)
       VALUES ($1, COALESCE($2,'ai_drafts_only'), COALESCE($3,true), $4)
       ON CONFLICT (user_id) DO UPDATE SET
         mode = COALESCE($2, mode),
         new_dm_enabled = COALESCE($3, new_dm_enabled),
         fcm_token = COALESCE($4, fcm_token),
         updated_at = now()
       RETURNING mode, new_dm_enabled, fcm_token IS NOT NULL AS has_fcm`,
      [auth.userId, s.notificationMode ?? null, s.newDmEnabled ?? null, s.fcmToken ?? null],
    );
    return reply.send({ settings: rows[0] });
  });

  app.get("/usage", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const summary = await usage.summary(auth.userId);
    return reply.send({ usage: summary });
  });

  // ---- Privacy: bulk delete endpoints (GDPR-friendly) ----
  app.post("/privacy/delete-conversations", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    await withTransaction(async (client) => {
      await client.query("DELETE FROM generation_history WHERE user_id=$1", [auth.userId]);
      await client.query("DELETE FROM conversation_memories WHERE user_id=$1", [auth.userId]);
      await client.query("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id=$1)", [auth.userId]);
      await client.query("DELETE FROM conversations WHERE user_id=$1", [auth.userId]);
    });
    await audit(auth.userId, "privacy.delete_conversations");
    return reply.send({ ok: true });
  });

  app.post("/privacy/delete-style-examples", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    await query("DELETE FROM style_examples WHERE user_id=$1", [auth.userId]);
    await audit(auth.userId, "privacy.delete_style_examples");
    return reply.send({ ok: true });
  });

  app.post("/privacy/delete-memories", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    await query("DELETE FROM conversation_memories WHERE user_id=$1", [auth.userId]);
    await audit(auth.userId, "privacy.delete_memories");
    return reply.send({ ok: true });
  });

  app.post("/privacy/reset-tone-profile", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    await query(
      `INSERT INTO tone_profiles (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET
         avg_message_length=24, formality=20, emoji_frequency=0.1,
         preferred_emojis='{}', common_slang='{}', common_phrases='{}',
         punctuation_style='minimal', capitalization='lowercase',
         humor_level=40, languages='{english}', hinglish_usage=0,
         asks_followups=true, mirrors_tone=true, learning_enabled=true,
         notes=NULL, updated_at=now()`,
      [auth.userId],
    );
    await audit(auth.userId, "privacy.reset_tone_profile");
    return reply.send({ ok: true });
  });

  app.post("/privacy/disable-learning", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    await query(
      `INSERT INTO tone_profiles (user_id, learning_enabled) VALUES ($1, false)
       ON CONFLICT (user_id) DO UPDATE SET learning_enabled=false, updated_at=now()`,
      [auth.userId],
    );
    await audit(auth.userId, "privacy.disable_learning");
    return reply.send({ ok: true });
  });

  app.post("/privacy/disable-memory", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    await query("UPDATE conversations SET memory_enabled=false WHERE user_id=$1", [auth.userId]);
    await audit(auth.userId, "privacy.disable_memory");
    return reply.send({ ok: true });
  });

  app.delete("/instagram/accounts/:id", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const res = await query("DELETE FROM instagram_accounts WHERE id=$1 AND user_id=$2", [id, auth.userId]);
    if ((res.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "not_found", message: "Account not found" });
    }
    await audit(auth.userId, "instagram.account_deleted", "instagram_account", id);
    return reply.send({ ok: true });
  });

  // ---- Turbo mode (send AI replies without prior approval) ----
  app.get("/automation/turbo", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    return reply.send({ turbo: await getTurbo(auth.userId) });
  });

  app.put("/automation/turbo", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const parsed = z
      .object({
        enabled: z.boolean(),
        acknowledgement: z.string().max(40).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: "enabled required" });
    }
    try {
      const turbo = await setTurbo(auth.userId, parsed.data.enabled, parsed.data.acknowledgement);
      return reply.send({ turbo });
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode === 400) {
        return reply.code(400).send({ error: "acknowledgement_required", message: e.message });
      }
      throw err;
    }
  });

  // ---- Automation rules ----
  app.get("/automation/rules", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { rows } = await query(
      `SELECT id, conversation_id, ig_account_id, rule_type, config, enabled, created_at
       FROM automation_rules WHERE user_id=$1 ORDER BY created_at DESC`,
      [auth.userId],
    );
    return reply.send({
      rules: rows.map((r) => ({
        id: r.id,
        conversationId: r.conversation_id,
        igAccountId: r.ig_account_id,
        ruleType: r.rule_type,
        config: r.config,
        enabled: r.enabled,
        createdAt: r.created_at,
      })),
    });
  });

  app.post("/automation/rules", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const parsed = ruleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: parsed.error.issues[0]?.message });
    }
    const r = parsed.data;
    // Ownership checks on referenced resources.
    if (r.conversationId) {
      const conv = await query("SELECT 1 FROM conversations WHERE id=$1 AND user_id=$2", [r.conversationId, auth.userId]);
      if (!conv.rows[0]) return reply.code(404).send({ error: "not_found", message: "Conversation not found" });
    }
    if (r.igAccountId) {
      const acc = await query("SELECT 1 FROM instagram_accounts WHERE id=$1 AND user_id=$2", [r.igAccountId, auth.userId]);
      if (!acc.rows[0]) return reply.code(404).send({ error: "not_found", message: "Account not found" });
    }
    const { rows } = await query(
      `INSERT INTO automation_rules (user_id, conversation_id, ig_account_id, rule_type, config, enabled)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [auth.userId, r.conversationId ?? null, r.igAccountId ?? null, r.ruleType, JSON.stringify(r.config), r.enabled],
    );
    await audit(auth.userId, "automation.rule_created", "automation_rule", rows[0].id);
    return reply.code(201).send({ id: rows[0].id });
  });

  app.put("/automation/rules/:id", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ enabled: z.boolean(), config: z.record(z.unknown()).optional() }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: "enabled required" });
    }
    const { rows } = await query(
      `UPDATE automation_rules SET enabled=$2, config=COALESCE($3, config), updated_at=now()
       WHERE id=$1 AND user_id=$4 RETURNING id`,
      [id, parsed.data.enabled, parsed.data.config ? JSON.stringify(parsed.data.config) : null, auth.userId],
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found", message: "Rule not found" });
    return reply.send({ ok: true });
  });

  app.delete("/automation/rules/:id", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const res = await query("DELETE FROM automation_rules WHERE id=$1 AND user_id=$2", [id, auth.userId]);
    if ((res.rowCount ?? 0) === 0) return reply.code(404).send({ error: "not_found", message: "Rule not found" });
    return reply.send({ ok: true });
  });
}
