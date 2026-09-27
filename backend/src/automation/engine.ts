/**
 * Automation engine. Evaluates user rules and hard guardrails.
 *
 * HARD RULES (non-negotiable):
 * - Default is draft-only. Auto-send only for conversations whose
 *   auto_reply_mode = 'automatic' AND user-level auto-send enabled.
 * - Unknown senders are never auto-sent to.
 * - Sensitive / urgent content is never auto-sent.
 * - Messages requiring unknown facts are never auto-sent (ask user).
 */
import { query } from "../db/pool.js";
import type { ClassificationResult } from "../ai/provider.js";
import { audit } from "../audit.js";
import { logger } from "../logger.js";
import { notificationProvider } from "../notifications/provider.js";

export interface AutoReplyDecision {
  action: "draft_only" | "auto_send" | "ask_user" | "skip";
  reason: string;
}

export async function evaluateAutoReply(opts: {
  userId: string;
  conversationId: string;
  incomingText: string;
  classification: ClassificationResult;
  isKnownContact: boolean;
}): Promise<AutoReplyDecision> {
  const { rows } = await query<{ auto_reply_mode: string; is_known_contact: boolean }>(
    "SELECT auto_reply_mode, is_known_contact FROM conversations WHERE id=$1 AND user_id=$2",
    [opts.conversationId, opts.userId],
  );
  const conv = rows[0];
  if (!conv) return { action: "skip", reason: "conversation_not_found" };

  // Hard guardrail 1: unknown sender -> never auto-send.
  if (!opts.isKnownContact || !conv.is_known_contact) {
    return { action: "draft_only", reason: "unknown_sender_never_auto" };
  }
  // Hard guardrail 2: sensitive content -> never auto-send.
  if (opts.classification.sensitive) {
    return { action: "draft_only", reason: "sensitive_content_never_auto" };
  }
  // Hard guardrail 3: needs facts we don't have -> ask user.
  if (opts.classification.requiresUnknownFacts) {
    return { action: "ask_user", reason: "requires_unknown_facts" };
  }
  if (conv.auto_reply_mode === "automatic") {
    // Check user has not created a never-auto rule for this conversation.
    const { rows: blocked } = await query(
      `SELECT 1 FROM automation_rules
       WHERE user_id=$1 AND conversation_id=$2 AND rule_type='sensitive_keywords_never_auto' AND enabled`,
      [opts.userId, opts.conversationId],
    );
    if (blocked.length) return { action: "draft_only", reason: "user_never_auto_rule" };
    await audit(opts.userId, "automation.auto_send", "conversation", opts.conversationId);
    return { action: "auto_send", reason: "auto_mode_enabled" };
  }
  if (conv.auto_reply_mode === "ask_approval") return { action: "ask_user", reason: "ask_approval_mode" };
  return { action: "draft_only", reason: "draft_only_mode" };
}

/**
 * Push an "approval needed" notification. Auto-send events are also made
 * clearly visible to the user after the fact.
 */
export async function notifyAutomationOutcome(
  userId: string,
  conversationId: string,
  decision: AutoReplyDecision,
): Promise<void> {
  const titles: Record<AutoReplyDecision["action"], string> = {
    draft_only: "AI draft ready",
    auto_send: "Auto-reply sent (automatic mode)",
    ask_user: "ToneAI needs your approval",
    skip: "Skipped",
  };
  await notificationProvider.sendToUser({
    userId,
    title: titles[decision.action],
    body: decision.reason,
    data: { type: "automation", conversationId },
  }).catch((err) => logger.warn("automation notify failed", { err: String(err) }));
}
