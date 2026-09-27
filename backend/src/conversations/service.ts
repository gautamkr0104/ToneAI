/**
 * Conversations service: sync from provider, ownership-checked access,
 * message classification and the send pipeline (approval-gated).
 */
import { query, withTransaction } from "../db/pool.js";
import type { MessagingProvider, AccountRef } from "../instagram/provider.js";
import { MockInstagramProvider } from "../instagram/mockProvider.js";
import { InstagramProvider } from "../instagram/provider.js";
import { aiProvider } from "../ai/index.js";
import { classifyHeuristic } from "../ai/mockProvider.js";
import { generateWithContext } from "../tone/engine.js";
import { refreshMemoryIfNeeded } from "../memory/service.js";
import { notificationProvider } from "../notifications/provider.js";
import { audit } from "../audit.js";
import { logger } from "../logger.js";
import { env } from "../config/env.js";
import type { ReplyMode } from "../ai/provider.js";
import { usage } from "./usage.js";
import { isTurboOn } from "../automation/turbo.js";
import { evaluateAutoReply, notifyAutomationOutcome } from "../automation/engine.js";

/** Resolve the messaging provider for an account row. */
export function providerFor(account: { provider: string }): MessagingProvider {
  if (account.provider === "instagram") return new InstagramProvider();
  return new MockInstagramProvider();
}

function accountRef(account: { ig_user_id: string; access_token_enc: string | null }): AccountRef {
  // Real tokens would be decrypted here (Android Keystore equivalent on server:
  // envelope encryption with a KMS master key). Mock provider ignores it.
  return {
    igUserId: account.ig_user_id,
    accessToken: account.access_token_enc ?? "mock",
    graphVersion: env.instagramGraphVersion,
  };
}

export interface ConversationRow {
  id: string;
  ig_account_id: string;
  user_id: string;
  external_conversation_id: string | null;
  participant_name: string;
  participant_avatar_url: string | null;
  is_known_contact: boolean;
  last_message_at: Date | null;
  last_message_preview: string | null;
  unread_count: number;
  memory_enabled: boolean;
  auto_reply_mode: string;
}

/** Ownership-checked conversation fetch — prevents IDOR. */
export async function getOwnedConversation(
  userId: string,
  conversationId: string,
): Promise<ConversationRow | null> {
  const { rows } = await query<ConversationRow>(
    `SELECT id, ig_account_id, user_id, external_conversation_id, participant_name,
            participant_avatar_url, is_known_contact, last_message_at,
            last_message_preview, unread_count, memory_enabled, auto_reply_mode
     FROM conversations WHERE id=$1 AND user_id=$2`,
    [conversationId, userId],
  );
  return rows[0] ?? null;
}

export async function getOwnedAccount(
  userId: string,
  igAccountId: string,
): Promise<{ id: string; ig_user_id: string; username: string; provider: string; access_token_enc: string | null; status: string; last_sync_at: Date | null } | null> {
  const { rows } = await query<{
    id: string;
    ig_user_id: string;
    username: string;
    provider: string;
    access_token_enc: string | null;
    status: string;
    last_sync_at: Date | null;
  }>(
    `SELECT id, ig_user_id, username, provider, access_token_enc, status, last_sync_at
     FROM instagram_accounts WHERE id=$1 AND user_id=$2`,
    [igAccountId, userId],
  );
  return rows[0] ?? null;
}

/** Sync conversations + messages from the provider into the local DB. */
export async function syncAccountConversations(userId: string, igAccountId: string): Promise<{ conversations: number; messages: number }> {
  const account = await getOwnedAccount(userId, igAccountId);
  if (!account) throw new Error("account_not_found");
  const provider = providerFor(account);
  const ref = accountRef(account);

  const externals = await provider.listConversations(ref);
  let messageCount = 0;
  for (const ext of externals) {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO conversations
         (ig_account_id, user_id, external_conversation_id, participant_name, is_known_contact, last_message_at, last_message_preview)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (ig_account_id, external_conversation_id) DO UPDATE
         SET participant_name=EXCLUDED.participant_name,
             last_message_at=EXCLUDED.last_message_at,
             last_message_preview=EXCLUDED.last_message_preview,
             updated_at=now()
       RETURNING id`,
      [
        igAccountId,
        userId,
        ext.externalId,
        ext.participantName,
        ext.isKnownContact,
        ext.messages.length ? ext.messages[ext.messages.length - 1].timestamp : null,
        ext.messages.length ? ext.messages[ext.messages.length - 1].text.slice(0, 80) : null,
      ],
    );
    const convId = rows[0].id;
    for (const m of ext.messages) {
      const inserted = await query(
        `INSERT INTO messages (conversation_id, ig_message_id, sender, text, created_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (ig_message_id) DO NOTHING`,
        [convId, m.externalId, m.sender, m.text, m.timestamp],
      );
      if ((inserted.rowCount ?? 0) > 0) messageCount++;
    }
    await query(
      `UPDATE conversations SET last_message_at = COALESCE(
         (SELECT MAX(created_at) FROM messages WHERE conversation_id=$1), last_message_at)
       WHERE id=$1`,
      [convId],
    );
  }
  await query("UPDATE instagram_accounts SET last_sync_at=now() WHERE id=$1", [igAccountId]);
  return { conversations: externals.length, messages: messageCount };
}

export async function listConversations(
  userId: string,
  igAccountId: string,
): Promise<Array<Record<string, unknown>>> {
  const { rows } = await query(
    `SELECT c.id, c.participant_name, c.participant_avatar_url, c.is_known_contact,
            c.last_message_at, c.last_message_preview, c.unread_count, c.auto_reply_mode,
            EXISTS (SELECT 1 FROM generation_history g WHERE g.conversation_id=c.id AND g.sent_at IS NULL AND g.reply_text <> '') AS has_draft
     FROM conversations c
     WHERE c.user_id=$1 AND c.ig_account_id=$2
     ORDER BY c.last_message_at DESC NULLS LAST
     LIMIT 100`,
    [userId, igAccountId],
  );
  return rows.map((r) => ({
    id: r.id,
    participantName: r.participant_name,
    participantAvatarUrl: r.participant_avatar_url,
    isKnownContact: r.is_known_contact,
    lastMessageAt: r.last_message_at,
    lastMessagePreview: r.last_message_preview,
    unreadCount: r.unread_count,
    autoReplyMode: r.auto_reply_mode,
    hasAiDraft: r.has_draft,
  }));
}

export async function listMessages(
  userId: string,
  conversationId: string,
): Promise<Array<Record<string, unknown>>> {
  const conv = await getOwnedConversation(userId, conversationId);
  if (!conv) throw new Error("conversation_not_found");
  const { rows } = await query(
    `SELECT id, sender, text, classification, sensitive, sent_via, created_at
     FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT 200`,
    [conversationId],
  );
  return rows.map((r) => ({
    id: r.id,
    sender: r.sender,
    text: r.text,
    classification: r.classification,
    sensitive: r.sensitive,
    sentVia: r.sent_via,
    createdAt: r.created_at,
  }));
}

export interface GenerateOptions {
  userId: string;
  conversationId: string;
  replyMode: ReplyMode;
  customInstruction?: string;
  previousGenerationId?: string;
}

export interface GeneratedDraft {
  generationId: string;
  reply: string;
  model: string;
  classification: string;
  sensitive: boolean;
  /** True when turbo mode sent this reply without prior approval. */
  autoSent: boolean;
}

/** Generate an AI draft reply (never auto-sends from here). */
export async function generateDraft(opts: GenerateOptions): Promise<GeneratedDraft> {
  const conv = await getOwnedConversation(opts.userId, opts.conversationId);
  if (!conv) throw new Error("conversation_not_found");

  // Find the latest incoming message as the reply target.
  const { rows: lastIncoming } = await query<{ text: string; id: string }>(
    `SELECT id, text FROM messages WHERE conversation_id=$1 AND sender='them' ORDER BY created_at DESC LIMIT 1`,
    [opts.conversationId],
  );
  const incoming = lastIncoming[0]?.text ?? "";

  if (conv.memory_enabled) {
    await refreshMemoryIfNeeded(aiProvider, opts.conversationId, opts.userId);
  }

  const result = await generateWithContext(aiProvider, {
    userId: opts.userId,
    conversationId: opts.conversationId,
    igAccountId: conv.ig_account_id,
    incomingMessage: incoming,
    replyMode: opts.replyMode,
    customInstruction: opts.customInstruction,
  });

  // Usage tracking (cost control)
  await usage.record(
    opts.userId,
    result.promptTokens,
    result.completionTokens,
    env.dailyTokenLimit,
    env.dailyGenerationLimit,
  );

  const { rows } = await query<{ id: string }>(
    `INSERT INTO generation_history (user_id, conversation_id, reply_text, reply_mode, custom_instruction, model, prompt_tokens, completion_tokens)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      opts.userId,
      opts.conversationId,
      result.reply,
      opts.replyMode,
      opts.customInstruction ?? null,
      result.model,
      result.promptTokens,
      result.completionTokens,
    ],
  );

  // Store classification on the incoming message.
  await query(
    "UPDATE messages SET classification=$2, sensitive=$3 WHERE id=$1",
    [lastIncoming[0]?.id ?? null, result.classification, result.sensitive],
  );

  if (opts.previousGenerationId) {
    await query("UPDATE generation_history SET accepted=false WHERE id=$1 AND user_id=$2", [
      opts.previousGenerationId,
      opts.userId,
    ]);
  }

  // ---- Turbo mode: send without prior approval when explicitly enabled. ----
  // Hard guardrails still apply inside evaluateAutoReply (unknown sender,
  // sensitive content, unknown-fact questions are NEVER auto-sent) and
  // sendApprovedMessage re-classifies and blocks unedited sensitive text.
  let autoSent = false;
  if (conv.auto_reply_mode === "automatic" && (await isTurboOn(opts.userId))) {
    try {
      const classification = await aiProvider.classifyMessage(incoming);
      const decision = await evaluateAutoReply({
        userId: opts.userId,
        conversationId: opts.conversationId,
        incomingText: incoming,
        classification,
        isKnownContact: conv.is_known_contact,
      });
      if (decision.action === "auto_send") {
        const sent = await sendApprovedMessage({
          userId: opts.userId,
          conversationId: opts.conversationId,
          text: result.reply,
          generationId: rows[0].id,
          edited: false,
        });
        autoSent = sent.ok;
        await notifyAutomationOutcome(opts.userId, opts.conversationId, decision);
      }
    } catch (err) {
      logger.warn("turbo auto-send failed", { err: String(err) });
    }
  }

  await notificationProvider.sendToUser({
    userId: opts.userId,
    title: autoSent ? "Turbo reply sent" : "AI reply ready",
    body: autoSent ? "Sent automatically (Turbo mode)" : "Draft ready for your review",
    data: { type: "draft_ready", conversationId: opts.conversationId },
  });

  return {
    generationId: rows[0].id,
    reply: result.reply,
    model: result.model,
    classification: result.classification,
    sensitive: result.sensitive,
    autoSent,
  };
}

/** Rewrite an existing draft with a quick action or custom instruction. */
export async function rewriteDraft(opts: {
  userId: string;
  conversationId: string;
  generationId: string;
  action?: string;
  customInstruction?: string;
}): Promise<GeneratedDraft> {
  const conv = await getOwnedConversation(opts.userId, opts.conversationId);
  if (!conv) throw new Error("conversation_not_found");
  const { rows } = await query<{ reply_text: string }>(
    "SELECT reply_text FROM generation_history WHERE id=$1 AND user_id=$2 AND conversation_id=$3",
    [opts.generationId, opts.userId, opts.conversationId],
  );
  const base = rows[0]?.reply_text;
  if (base === undefined) throw new Error("generation_not_found");

  const actionMap: Record<string, { mode?: ReplyMode; instruction?: string }> = {
    shorter: { instruction: "Make it shorter, keep the exact same tone." },
    longer: { instruction: "Make it a bit longer, keep the exact same tone." },
    more_casual: { mode: "casual" },
    more_natural: { instruction: "Make it sound more natural and human, less polished." },
    more_confident: { instruction: "Make it more confident, keep my style." },
    more_polite: { instruction: "Make it more polite, keep my style." },
    funnier: { instruction: "Make it funnier in my style." },
    remove_emojis: { instruction: "Remove all emojis." },
    add_emojis: { instruction: "Add one or two emojis like I would." },
    translate: { instruction: "Translate to Hinglish keeping my style." },
  };

  const override = actionMap[opts.action ?? ""];
  const replyMode: ReplyMode = override?.mode ?? "normal";
  const customInstruction =
    opts.customInstruction ?? override?.instruction ?? "Rewrite to sound more like me.";

  const result = await generateWithContext(aiProvider, {
    userId: opts.userId,
    conversationId: opts.conversationId,
    igAccountId: conv.ig_account_id,
    incomingMessage: base, // rewrite against the draft text itself
    replyMode,
    customInstruction: "Rewrite this draft. " + customInstruction,
  });

  await usage.record(opts.userId, result.promptTokens, result.completionTokens, env.dailyTokenLimit, env.dailyGenerationLimit);

  const { rows: ins } = await query<{ id: string }>(
    `INSERT INTO generation_history (user_id, conversation_id, reply_text, reply_mode, custom_instruction, model, prompt_tokens, completion_tokens)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      opts.userId,
      opts.conversationId,
      result.reply,
      replyMode,
      customInstruction,
      result.model,
      result.promptTokens,
      result.completionTokens,
    ],
  );
  await query("UPDATE generation_history SET accepted=false WHERE id=$1 AND user_id=$2", [
    opts.generationId,
    opts.userId,
  ]);
  return {
    generationId: ins[0].id,
    reply: result.reply,
    model: result.model,
    classification: "rewrite",
    sensitive: false,
    autoSent: false,
  };
}

/**
 * Send a message through the supported provider API. Called ONLY after
 * explicit user approval. Enforces sensitive-content guardrails.
 */
export async function sendApprovedMessage(opts: {
  userId: string;
  conversationId: string;
  text: string;
  generationId?: string;
  edited?: boolean;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const conv = await getOwnedConversation(opts.userId, opts.conversationId);
  if (!conv) throw new Error("conversation_not_found");

  const account = await getOwnedAccount(opts.userId, conv.ig_account_id);
  if (!account) throw new Error("account_not_found");

  // Classification guardrail — never auto-send sensitive content.
  const cls = await aiProvider.classifyMessage(opts.text);
  if (cls.sensitive && !opts.edited) {
    return {
      ok: false,
      error:
        "sensitive_content_blocked: this draft was flagged as sensitive and must be reviewed/edited by you before sending.",
    };
  }

  const provider = providerFor(account);
  const ref = accountRef(account);
  const result = await provider.sendMessage(ref, conv.external_conversation_id ?? "", opts.text);

  if (result.ok) {
    await query(
      `INSERT INTO messages (conversation_id, ig_message_id, sender, text, sent_via)
       VALUES ($1,$2,'me',$3,$4)`,
      [opts.conversationId, result.externalMessageId ?? null, opts.text, "toneai-approved"],
    );
    await query(
      `UPDATE conversations SET last_message_at=now(), last_message_preview=$2, updated_at=now() WHERE id=$1`,
      [opts.conversationId, opts.text.slice(0, 80)],
    );
    if (opts.generationId) {
      await query(
        "UPDATE generation_history SET sent_at=now(), accepted=true, edited=$2 WHERE id=$1 AND user_id=$3",
        [opts.generationId, opts.edited ?? false, opts.userId],
      );
    }
    await audit(opts.userId, "message.sent", "conversation", opts.conversationId);
  } else {
    logger.warn("send failed via provider", { error: result.error });
  }
  return { ok: result.ok, messageId: result.externalMessageId, error: result.error };
}

export { classifyHeuristic };
