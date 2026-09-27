import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { query } from "../db/pool.js";
import { logger } from "../logger.js";
import { authGuard, requireAuth, type AuthedRequest } from "../auth/guard.js";
import { audit } from "../audit.js";
import { aiProvider } from "../ai/index.js";
import { pseudoEmbedding } from "../crypto.js";
import { importChatsForUser } from "./importChats.js";
import { query as dbQuery } from "../db/pool.js";

const profilePatchSchema = z.object({
  avgMessageLength: z.number().int().min(1).max(500).optional(),
  formality: z.number().int().min(0).max(100).optional(),
  emojiFrequency: z.number().min(0).max(1).optional(),
  preferredEmojis: z.array(z.string().max(8)).max(20).optional(),
  commonSlang: z.array(z.string().max(30)).max(50).optional(),
  commonPhrases: z.array(z.string().max(120)).max(50).optional(),
  punctuationStyle: z.enum(["minimal", "heavy", "standard"]).optional(),
  capitalization: z.enum(["lowercase", "standard", "caps"]).optional(),
  humorLevel: z.number().int().min(0).max(100).optional(),
  languages: z.array(z.string().max(30)).max(10).optional(),
  hinglishUsage: z.number().min(0).max(1).optional(),
  asksFollowups: z.boolean().optional(),
  mirrorsTone: z.boolean().optional(),
  learningEnabled: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});

const styleExampleSchema = z.object({
  text: z.string().min(1).max(500),
  category: z.string().max(50).optional(),
  language: z.string().max(30).optional(),
  tone: z.string().max(50).optional(),
  situation: z.string().max(200).optional(),
  igAccountId: z.string().uuid().optional(),
});

export async function registerToneRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tone-profile", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { rows } = await query(
      `SELECT user_id, ig_account_id, avg_message_length, formality, emoji_frequency,
              preferred_emojis, common_slang, common_phrases, punctuation_style,
              capitalization, humor_level, languages, hinglish_usage,
              asks_followups, mirrors_tone, learning_enabled, notes, updated_at
       FROM tone_profiles WHERE user_id=$1 ORDER BY ig_account_id NULLS LAST LIMIT 1`,
      [auth.userId],
    );
    if (!rows[0]) {
      // lazily create default profile
      const created = await query(
        `INSERT INTO tone_profiles (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE SET updated_at=now()
         RETURNING *`,
        [auth.userId],
      );
      return reply.send({ toneProfile: mapProfile(created.rows[0]) });
    }
    return reply.send({ toneProfile: mapProfile(rows[0]) });
  });

  app.put("/tone-profile", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const parsed = profilePatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: parsed.error.issues[0]?.message });
    }
    const p = parsed.data;
    await query(
      `INSERT INTO tone_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [auth.userId],
    );
    const { rows } = await query(
      `UPDATE tone_profiles SET
         avg_message_length = COALESCE($2, avg_message_length),
         formality = COALESCE($3, formality),
         emoji_frequency = COALESCE($4, emoji_frequency),
         preferred_emojis = COALESCE($5, preferred_emojis),
         common_slang = COALESCE($6, common_slang),
         common_phrases = COALESCE($7, common_phrases),
         punctuation_style = COALESCE($8, punctuation_style),
         capitalization = COALESCE($9, capitalization),
         humor_level = COALESCE($10, humor_level),
         languages = COALESCE($11, languages),
         hinglish_usage = COALESCE($12, hinglish_usage),
         asks_followups = COALESCE($13, asks_followups),
         mirrors_tone = COALESCE($14, mirrors_tone),
         learning_enabled = COALESCE($15, learning_enabled),
         notes = COALESCE($16, notes),
         updated_at = now()
       WHERE user_id=$1
       RETURNING *`,
      [
        auth.userId,
        p.avgMessageLength ?? null,
        p.formality ?? null,
        p.emojiFrequency ?? null,
        p.preferredEmojis ? p.preferredEmojis : null,
        p.commonSlang ?? null,
        p.commonPhrases ?? null,
        p.punctuationStyle ?? null,
        p.capitalization ?? null,
        p.humorLevel ?? null,
        p.languages ?? null,
        p.hinglishUsage ?? null,
        p.asksFollowups ?? null,
        p.mirrorsTone ?? null,
        p.learningEnabled ?? null,
        p.notes ?? null,
    ],
    );
    await audit(auth.userId, "tone_profile.updated");
    return reply.send({ toneProfile: mapProfile(rows[0]) });
  });

  app.post("/tone-profile/reset", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
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
    await audit(auth.userId, "tone_profile.reset");
    return reply.send({ ok: true });
  });

  app.get("/style-examples", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const q = request.query as { limit?: string; offset?: string; igAccountId?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    const offset = Math.max(Number(q.offset ?? 0), 0);
    const { rows } = await query(
      `SELECT id, text, category, language, tone, situation, source, created_at
       FROM style_examples
       WHERE user_id=$1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [auth.userId, limit, offset],
    );
    return reply.send({ examples: rows.map(mapStyleExample), total: rows.length });
  });

  app.post("/style-examples", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const parsed = styleExampleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: parsed.error.issues[0]?.message });
    }
    const e = parsed.data;
    const embedding = await aiProvider.createEmbedding(e.text);
    const { rows } = await query<{ id: string; created_at: Date }>(
      `INSERT INTO style_examples (user_id, ig_account_id, text, category, language, tone, situation, embedding, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual')
       RETURNING id, created_at`,
      [
        auth.userId,
        e.igAccountId ?? null,
        e.text,
        e.category ?? null,
        e.language ?? "english",
        e.tone ?? null,
        e.situation ?? null,
        JSON.stringify(embedding),
      ],
    );
    await audit(auth.userId, "style_example.created", "style_example", rows[0].id);
    return reply.code(201).send({ id: rows[0].id, createdAt: rows[0].created_at });
  });

  app.delete("/style-examples/:id", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const res = await query(
      "DELETE FROM style_examples WHERE id=$1 AND user_id=$2",
      [id, auth.userId],
    );
    if ((res.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "not_found", message: "Example not found" });
    }
    await audit(auth.userId, "style_example.deleted", "style_example", id);
    return reply.send({ ok: true });
  });

  app.post("/style-examples/reset", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    await query("DELETE FROM style_examples WHERE user_id=$1", [auth.userId]);
    await audit(auth.userId, "style_examples.reset");
    return reply.send({ ok: true });
  });

  // ---- Instagram chat-export import ("Download your information" JSON) ----
  app.post(
    "/import-chats",
    {
      preHandler: [authGuard],
      // IG exports can be several MB of JSON.
      bodyLimit: 32 * 1024 * 1024,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const body = request.body as { json?: unknown; accountHint?: string; igAccountId?: string } | undefined;
      const payload = body?.json ?? request.body;
      const accountHint = typeof body?.accountHint === "string" ? body.accountHint : undefined;
      const igAccountId = typeof body?.igAccountId === "string" ? body.igAccountId : undefined;
      try {
        const result = await importChatsForUser(auth.userId, payload, accountHint, igAccountId);
        return reply.send({ ok: true, ...result });
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        if (e.statusCode === 400) {
          return reply.code(400).send({ error: "invalid_import", message: e.message });
        }
        logger.warn("chat import failed", { err: String(err) });
        return reply.code(500).send({ error: "internal_error", message: "Import failed" });
      }
    },
  );

  app.get("/import-chats/status", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { rows } = await dbQuery<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM style_examples WHERE user_id=$1 AND source='ig_import'",
      [auth.userId],
    );
    const { rows: prof } = await dbQuery<{ updated_at: Date | null }>(
      "SELECT updated_at FROM tone_profiles WHERE user_id=$1",
      [auth.userId],
    );
    return reply.send({
      importedExamples: Number(rows[0]?.n ?? 0),
      lastImportAt: prof[0]?.updated_at ?? null,
    });
  });
}

function mapProfile(r: Record<string, unknown>) {
  return {
    avgMessageLength: r.avg_message_length,
    formality: r.formality,
    emojiFrequency: r.emoji_frequency,
    preferredEmojis: r.preferred_emojis,
    commonSlang: r.common_slang,
    commonPhrases: r.common_phrases,
    punctuationStyle: r.punctuation_style,
    capitalization: r.capitalization,
    humorLevel: r.humor_level,
    languages: r.languages,
    hinglishUsage: r.hinglish_usage,
    asksFollowups: r.asks_followups,
    mirrorsTone: r.mirrors_tone,
    learningEnabled: r.learning_enabled,
    notes: r.notes,
    updatedAt: r.updated_at,
  };
}

function mapStyleExample(r: Record<string, unknown>) {
  return {
    id: r.id,
    text: r.text,
    category: r.category,
    language: r.language,
    tone: r.tone,
    situation: r.situation,
    source: r.source,
    createdAt: r.created_at,
  };
}

// ensure pseudoEmbedding stays referenced for provider fallbacks
void pseudoEmbedding;
