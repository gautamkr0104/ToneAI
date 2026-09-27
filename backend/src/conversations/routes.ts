import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authGuard, requireAuth, type AuthedRequest } from "../auth/guard.js";
import {
  listConversations,
  listMessages,
  getOwnedConversation,
  getOwnedAccount,
  generateDraft,
  rewriteDraft,
  sendApprovedMessage,
} from "./service.js";
import { getOrCreateMemory, updateMemoryManual, deleteMemory } from "../memory/service.js";
import { usage } from "./usage.js";

const generateSchema = z.object({
  replyMode: z
    .enum(["normal", "casual", "funny", "flirty", "professional", "friendly", "dry", "short", "detailed", "hindi", "hinglish", "english", "match_tone"])
    .default("normal"),
  customInstruction: z.string().max(300).optional(),
  previousGenerationId: z.string().uuid().optional(),
});

const rewriteSchema = z.object({
  generationId: z.string().uuid(),
  action: z
    .enum(["shorter", "longer", "more_casual", "more_natural", "more_confident", "more_polite", "funnier", "remove_emojis", "add_emojis", "translate"])
    .optional(),
  customInstruction: z.string().max(300).optional(),
});

const sendSchema = z.object({
  text: z.string().min(1).max(1000),
  generationId: z.string().uuid().optional(),
  edited: z.boolean().optional(),
});

const memoryPatchSchema = z.object({
  summary: z.string().max(2000).optional(),
  importantFacts: z.array(z.string().max(300)).max(20).optional(),
  unansweredQuestions: z.array(z.string().max(300)).max(20).optional(),
  toneContext: z.string().max(300).optional(),
  language: z.string().max(30).optional(),
  memoryEnabled: z.boolean().optional(),
});

function handleError(reply: FastifyReply, err: unknown): FastifyReply {
  const msg = String(err);
  if (msg.includes("conversation_not_found") || msg.includes("account_not_found") || msg.includes("generation_not_found")) {
    return reply.code(404).send({ error: "not_found", message: "Resource not found" });
  }
  if (msg.includes("quota_exceeded")) {
    return reply.code(429).send({ error: "quota_exceeded", message: msg.split(": ")[1] ?? "Daily limit reached" });
  }
  return reply.code(500).send({ error: "internal_error", message: "Something went wrong" });
}

export async function registerConversationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/conversations", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const q = request.query as { igAccountId?: string };
    if (!q.igAccountId) {
      return reply.code(400).send({ error: "invalid_input", message: "igAccountId required" });
    }
    const account = await getOwnedAccount(auth.userId, q.igAccountId);
    if (!account) return reply.code(404).send({ error: "not_found", message: "Account not found" });
    const conversations = await listConversations(auth.userId, q.igAccountId);
    return reply.send({ conversations });
  });

  app.get("/conversations/:id", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const conv = await getOwnedConversation(auth.userId, id);
    if (!conv) return reply.code(404).send({ error: "not_found", message: "Conversation not found" });
    return reply.send({
      conversation: {
        id: conv.id,
        participantName: conv.participant_name,
        participantAvatarUrl: conv.participant_avatar_url,
        isKnownContact: conv.is_known_contact,
        lastMessageAt: conv.last_message_at,
        unreadCount: conv.unread_count,
        memoryEnabled: conv.memory_enabled,
        autoReplyMode: conv.auto_reply_mode,
      },
    });
  });

  app.get("/conversations/:id/messages", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    try {
      const messages = await listMessages(auth.userId, id);
      // Mark unread as read on open.
      await query("UPDATE conversations SET unread_count=0 WHERE id=$1 AND user_id=$2", [id, auth.userId]);
      return reply.send({ messages });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/conversations/:id/generate", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = generateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: parsed.error.issues[0]?.message });
    }
    await usage.checkQuota(auth.userId);
    try {
      const draft = await generateDraft({
        userId: auth.userId,
        conversationId: id,
        replyMode: parsed.data.replyMode,
        customInstruction: parsed.data.customInstruction,
        previousGenerationId: parsed.data.previousGenerationId,
      });
      return reply.send({ draft });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/conversations/:id/regenerate", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = generateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: "replyMode invalid" });
    }
    await usage.checkQuota(auth.userId);
    try {
      const { rows } = await query<{ id: string }>(
        "SELECT id FROM generation_history WHERE conversation_id=$1 AND user_id=$2 AND sent_at IS NULL ORDER BY created_at DESC LIMIT 1",
        [id, auth.userId],
      );
      const draft = await generateDraft({
        userId: auth.userId,
        conversationId: id,
        replyMode: parsed.data.replyMode,
        customInstruction: parsed.data.customInstruction,
        previousGenerationId: rows[0]?.id,
      });
      return reply.send({ draft });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/conversations/:id/rewrite", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = rewriteSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: "generationId required" });
    }
    await usage.checkQuota(auth.userId);
    try {
      const draft = await rewriteDraft({
        userId: auth.userId,
        conversationId: id,
        generationId: parsed.data.generationId,
        action: parsed.data.action,
        customInstruction: parsed.data.customInstruction,
      });
      return reply.send({ draft });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/conversations/:id/send", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = sendSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: "text required" });
    }
    try {
      const result = await sendApprovedMessage({
        userId: auth.userId,
        conversationId: id,
        text: parsed.data.text,
        generationId: parsed.data.generationId,
        edited: parsed.data.edited,
      });
      if (!result.ok) {
        return reply.code(422).send({ error: "send_failed", message: result.error ?? "Provider rejected the message" });
      }
      return reply.send({ ok: true, messageId: result.messageId });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.put("/conversations/:id/settings", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        autoReplyMode: z.enum(["off", "draft_only", "ask_approval", "automatic"]).optional(),
        memoryEnabled: z.boolean().optional(),
        isKnownContact: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: "invalid settings" });
    }
    const { rows } = await query(
      `UPDATE conversations SET
         auto_reply_mode = COALESCE($2, auto_reply_mode),
         memory_enabled = COALESCE($3, memory_enabled),
         is_known_contact = COALESCE($4, is_known_contact),
         updated_at = now()
       WHERE id=$1 AND user_id=$5
       RETURNING id`,
      [id, parsed.data.autoReplyMode ?? null, parsed.data.memoryEnabled ?? null, parsed.data.isKnownContact ?? null, auth.userId],
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found", message: "Conversation not found" });
    return reply.send({ ok: true });
  });

  // ---- Memory endpoints scoped to conversations ----
  app.get("/memories/:conversationId", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { conversationId } = request.params as { conversationId: string };
    const conv = await getOwnedConversation(auth.userId, conversationId);
    if (!conv) return reply.code(404).send({ error: "not_found", message: "Conversation not found" });
    const memory = await getOrCreateMemory(conversationId, auth.userId);
    return reply.send({
      memory: {
        summary: memory.summary,
        importantFacts: memory.important_facts,
        unansweredQuestions: memory.unanswered_questions,
        language: memory.language,
        toneContext: memory.tone_context,
        updatedAt: memory.updated_at,
      },
    });
  });

  app.put("/memories/:conversationId", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { conversationId } = request.params as { conversationId: string };
    const conv = await getOwnedConversation(auth.userId, conversationId);
    if (!conv) return reply.code(404).send({ error: "not_found", message: "Conversation not found" });
    const parsed = memoryPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", message: "invalid memory patch" });
    }
    if (parsed.data.memoryEnabled !== undefined) {
      await query("UPDATE conversations SET memory_enabled=$2 WHERE id=$1 AND user_id=$3", [
        conversationId,
        parsed.data.memoryEnabled,
        auth.userId,
      ]);
    }
    const memory = await updateMemoryManual(auth.userId, conversationId, {
      summary: parsed.data.summary,
      importantFacts: parsed.data.importantFacts,
      unansweredQuestions: parsed.data.unansweredQuestions,
      toneContext: parsed.data.toneContext,
      language: parsed.data.language,
    });
    return reply.send({ ok: true, memory });
  });

  app.delete("/memories/:conversationId", { preHandler: [authGuard] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = requireAuth(request);
    const { conversationId } = request.params as { conversationId: string };
    const conv = await getOwnedConversation(auth.userId, conversationId);
    if (!conv) return reply.code(404).send({ error: "not_found", message: "Conversation not found" });
    await deleteMemory(auth.userId, conversationId);
    return reply.send({ ok: true });
  });
}
