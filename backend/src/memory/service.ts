/**
 * Conversation memory service. Maintains per-conversation memory so the full
 * history is NOT sent to the AI every time: summary + facts + unanswered
 * questions + bounded recent window.
 */
import { query } from "../db/pool.js";
import type { AIProvider, RecentMessage } from "../ai/provider.js";
import { audit } from "../audit.js";
import { logger } from "../logger.js";

export interface MemoryRow {
  id: string;
  conversation_id: string;
  summary: string;
  important_facts: string[];
  unanswered_questions: string[];
  language: string | null;
  tone_context: string | null;
  updated_at: Date;
}

const SUMMARIZE_THRESHOLD = 24;
const KEEP_RECENT = 12;

export async function getOrCreateMemory(conversationId: string, userId: string): Promise<MemoryRow> {
  const existing = await query<MemoryRow>(
    `SELECT id, conversation_id, summary, important_facts, unanswered_questions, language, tone_context, updated_at
     FROM conversation_memories WHERE conversation_id=$1 AND user_id=$2`,
    [conversationId, userId],
  );
  if (existing.rows[0]) return existing.rows[0];
  const inserted = await query<MemoryRow>(
    `INSERT INTO conversation_memories (conversation_id, user_id)
     VALUES ($1,$2)
     ON CONFLICT (conversation_id) DO UPDATE SET updated_at=now()
     RETURNING id, conversation_id, summary, important_facts, unanswered_questions, language, tone_context, updated_at`,
    [conversationId, userId],
  );
  return inserted.rows[0];
}

/**
 * Refresh memory if enough new messages accumulated. Cheap: only runs on
 * demand (before generation) and uses the fast model.
 */
export async function refreshMemoryIfNeeded(
  ai: AIProvider,
  conversationId: string,
  userId: string,
): Promise<void> {
  const memory = await getOrCreateMemory(conversationId, userId);
  const { rows } = await query<{ id: string; sender: string; text: string; created_at: Date }>(
    `SELECT id, sender, text, created_at FROM messages
     WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 60`,
    [conversationId],
  );
  if (rows.length < SUMMARIZE_THRESHOLD) return;
  const recent: RecentMessage[] = rows
    .slice(0, KEEP_RECENT)
    .reverse()
    .map((m) => ({ sender: m.sender as "them" | "me", text: m.text }));
  const older: RecentMessage[] = rows
    .slice(KEEP_RECENT)
    .reverse()
    .map((m) => ({ sender: m.sender as "them" | "me", text: m.text }));
  if (!older.length) return;

  const result = await ai.summarizeConversation([...older, ...recent]);
  await query(
    `UPDATE conversation_memories
     SET summary=$2, important_facts=$3, unanswered_questions=$4, language=$5, updated_at=now()
     WHERE id=$1`,
    [
      memory.id,
      result.summary,
      JSON.stringify(result.importantFacts ?? []),
      JSON.stringify(result.unansweredQuestions ?? []),
      result.language ?? null,
    ],
  );
  logger.info("memory refreshed", { conversationId, userId });
}

export async function updateMemoryManual(
  userId: string,
  conversationId: string,
  patch: { summary?: string; importantFacts?: string[]; unansweredQuestions?: string[]; toneContext?: string; language?: string },
): Promise<MemoryRow | null> {
  await getOrCreateMemory(conversationId, userId);
  const { rows } = await query<MemoryRow>(
    `UPDATE conversation_memories SET
       summary = COALESCE($3, summary),
       important_facts = COALESCE($4, important_facts),
       unanswered_questions = COALESCE($5, unanswered_questions),
       tone_context = COALESCE($6, tone_context),
       language = COALESCE($7, language),
       updated_at = now()
     WHERE conversation_id=$1 AND user_id=$2
     RETURNING id, conversation_id, summary, important_facts, unanswered_questions, language, tone_context, updated_at`,
    [
      conversationId,
      userId,
      patch.summary ?? null,
      patch.importantFacts ? JSON.stringify(patch.importantFacts) : null,
      patch.unansweredQuestions ? JSON.stringify(patch.unansweredQuestions) : null,
      patch.toneContext ?? null,
      patch.language ?? null,
    ],
  );
  return rows[0] ?? null;
}

export async function deleteMemory(userId: string, conversationId: string): Promise<boolean> {
  const res = await query(
    "DELETE FROM conversation_memories WHERE conversation_id=$1 AND user_id=$2",
    [conversationId, userId],
  );
  await audit(userId, "memory.deleted", "conversation", conversationId);
  return (res.rowCount ?? 0) > 0;
}
