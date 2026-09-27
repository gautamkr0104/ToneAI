/**
 * Tone Engine — the heart of ToneAI.
 *
 * Builds the AI prompt context from:
 *   1. System instructions
 *   2. User ToneProfile
 *   3. Relevant style examples (embedding retrieval)
 *   4. Conversation summary / memory
 *   5. Recent messages (bounded window)
 *   6. Current incoming message
 *   7. Reply mode
 *   8. Custom instruction
 *
 * Naturalness over grammar. Never fabricate user facts.
 */
import type { AIProvider, ReplyRequest, ReplyResponse, ReplyMode } from "../ai/provider.js";
import { query } from "../db/pool.js";
import { cosine } from "../crypto.js";
import { logger } from "../logger.js";

const RECENT_WINDOW = 12;

export async function loadToneProfile(
  userId: string,
  igAccountId: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await query(
    `SELECT * FROM tone_profiles WHERE user_id=$1 AND (ig_account_id=$2 OR ig_account_id IS NULL)
     ORDER BY ig_account_id NULLS LAST LIMIT 1`,
    [userId, igAccountId],
  );
  return rows[0] ?? null;
}

export async function retrieveStyleExamples(
  userId: string,
  igAccountId: string,
  incomingText: string,
  provider: AIProvider,
  limit = 5,
): Promise<Array<{ text: string; category?: string; tone?: string; similarity: number }>> {
  const { rows } = await query<{ id: string; text: string; category: string | null; tone: string | null; embedding: unknown }>(
    `SELECT id, text, category, tone, embedding FROM style_examples
     WHERE user_id=$1 AND (ig_account_id=$2 OR ig_account_id IS NULL)
     ORDER BY created_at DESC LIMIT 200`,
    [userId, igAccountId],
  );
  if (!rows.length) return [];
  const queryVec = await provider.createEmbedding(incomingText);
  const scored = rows.map((r) => {
    let sim = 0;
    if (r.embedding && typeof r.embedding === "object") {
      const arr = r.embedding as unknown as number[];
      if (Array.isArray(arr) && arr.length) sim = cosine(queryVec, arr);
    }
    return { text: r.text, category: r.category ?? undefined, tone: r.tone ?? undefined, similarity: sim };
  });
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

export async function loadMemory(conversationId: string): Promise<{
  summary: string;
  importantFacts: string[];
  unansweredQuestions: string[];
  language?: string;
  toneContext?: string;
} | null> {
  const { rows } = await query<{
    summary: string;
    important_facts: string[];
    unanswered_questions: string[];
    language: string | null;
    tone_context: string | null;
  }>(
    `SELECT summary, important_facts, unanswered_questions, language, tone_context
     FROM conversation_memories WHERE conversation_id=$1`,
    [conversationId],
  );
  const m = rows[0];
  if (!m) return null;
  return {
    summary: m.summary,
    importantFacts: m.important_facts ?? [],
    unansweredQuestions: m.unanswered_questions ?? [],
    language: m.language ?? undefined,
    toneContext: m.tone_context ?? undefined,
  };
}

export interface GenerationContext {
  userId: string;
  conversationId: string;
  igAccountId: string;
  incomingMessage: string;
  replyMode: ReplyMode;
  customInstruction?: string;
}

/**
 * Assemble the full ReplyRequest from DB state and run generation.
 */
export async function generateWithContext(
  ai: AIProvider,
  ctx: GenerationContext,
): Promise<ReplyResponse & { classification: string; sensitive: boolean }> {
  const [profileRow, memory] = await Promise.all([
    loadToneProfile(ctx.userId, ctx.igAccountId),
    loadMemory(ctx.conversationId),
  ]);

  const { rows: msgRows } = await query<{ sender: string; text: string }>(
    `SELECT sender, text FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [ctx.conversationId, RECENT_WINDOW],
  );
  const recentMessages = msgRows
    .reverse()
    .map((m) => ({ sender: m.sender as "them" | "me", text: m.text }));

  const styleExamples = await retrieveStyleExamples(
    ctx.userId,
    ctx.igAccountId,
    ctx.incomingMessage,
    ai,
  );

  const classification = await ai.classifyMessage(ctx.incomingMessage);

  const profile = profileRow ?? {};
  const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

  const req: ReplyRequest = {
    incomingMessage: ctx.incomingMessage,
    recentMessages,
    toneProfile: {
      avgMessageLength: num(profile.avg_message_length, 24),
      formality: num(profile.formality, 20),
      emojiFrequency: num(profile.emoji_frequency, 0.1),
      preferredEmojis: strArr(profile.preferred_emojis),
      commonSlang: strArr(profile.common_slang),
      commonPhrases: strArr(profile.common_phrases),
      punctuationStyle: (profile.punctuation_style as string) ?? "minimal",
      capitalization: (profile.capitalization as string) ?? "lowercase",
      humorLevel: num(profile.humor_level, 40),
      languages: strArr(profile.languages).length ? strArr(profile.languages) : ["english"],
      hinglishUsage: num(profile.hinglish_usage, 0),
      asksFollowups: profile.asks_followups !== false,
      mirrorsTone: profile.mirrors_tone !== false,
      notes: (profile.notes as string) ?? undefined,
    },
    styleExamples,
    memory: memory ?? undefined,
    replyMode: ctx.replyMode,
    customInstruction: ctx.customInstruction,
  };

  const response = await ai.generateReply(req);
  logger.info("reply generated", {
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    model: response.model,
    classification: classification.classification,
  });
  return {
    ...response,
    classification: classification.classification,
    sensitive: classification.sensitive,
  };
}
