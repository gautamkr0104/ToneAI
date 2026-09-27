/**
 * MockAIProvider: deterministic, offline AI used for development and tests.
 * Emulates the natural-tone rules (slang preservation, lowercase, emoji
 * habits, Hinglish) without any network calls.
 */
import type {
  AIProvider,
  ClassificationResult,
  MessageClass,
  ReplyRequest,
  ReplyResponse,
  RecentMessage,
  SummarizationResult,
} from "./provider.js";
import { pseudoEmbedding } from "../crypto.js";

const QUESTION_WORDS = /^(who|what|when|where|why|how|kya|kab|kaise|kaun)\b/i;

// Direct questions: question word or auxiliary verb followed by "?" anywhere.
// Checked before invitations so "are you coming tonight?" is a question,
// while "party at my place this weekend, coming?" stays an invitation.
const DIRECT_QUESTION =
  /^(who|what|when|where|why|how|kya|kab|kaise|kaun|are|is|am|do|does|did|can|could|will|would|should|have|has|had)\b[\s\S]*\?/i;

const SENSITIVE_HINTS =
  /(password|otp|cvv|card number|bank|salary|loan|suicide|kill|threat|legal|lawyer|medical report|diagnosis|prescription|hiv|pregnan)/i;

const URGENT_HINTS =
  /(urgent|asap|emergency|hospital|accident|immediately|abhi)/i;

function classify(text: string): MessageClass {
  const t = text.toLowerCase();
  if (SENSITIVE_HINTS.test(t)) return "sensitive";
  if (/^(hi|hello|hey|yo|namaste|hii+|hlo)\b/i.test(t.trim())) return "greeting";
  if (/(meeting|deadline|invoice|client|office|interview|report|standup)/i.test(t)) return "work";
  if (/(order|refund|delivery|support|complaint|damaged|return)/i.test(t)) return "customer_support";
  if (/(complaint|worst|terrible|angry|unacceptable)/i.test(t)) return "complaint";
  if (DIRECT_QUESTION.test(t.trim())) return "question";
  if (/(dinner|movie|party|coming|tonight|weekend|hangout|meet up)/i.test(t)) return "invitation";
  if (/(please|can you|could you|send|share|bhej|bhejde)/i.test(t)) return "request";
  if (QUESTION_WORDS.test(t) || t.includes("?")) return "question";
  if (/(cute|pretty|beautiful|miss you|<3|😍|❤️)/i.test(t)) return "flirting";
  return "casual";
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export class MockAIProvider implements AIProvider {
  readonly name = "mock-ai";

  async generateReply(req: ReplyRequest): Promise<ReplyResponse> {
    const cls = await this.classifyMessage(req.incomingMessage);
    const reply = this.craftReply(req, cls.classification);
    const promptTokens =
      estimateTokens(req.incomingMessage) +
      req.recentMessages.reduce((s, m) => s + estimateTokens(m.text), 0);
    return {
      reply,
      model: "mock-ai",
      promptTokens,
      completionTokens: estimateTokens(reply),
    };
  }

  private craftReply(req: ReplyRequest, cls: MessageClass): string {
    const tone = req.toneProfile;
    const mode = req.replyMode;
    const lower = req.incomingMessage.toLowerCase();

    // Start from the user's natural vocabulary.
    const slang = tone.commonSlang[0] ?? "";
    const emoji = tone.preferredEmojis[0] ?? "";
    const useEmoji = Math.random() < Math.max(0.1, tone.emojiFrequency);

    let base: string;
    if (cls === "question" || /\?$/.test(req.incomingMessage.trim())) {
      base = "yeah probably, what time?";
      if (/(send|share|notes|file)/i.test(lower)) base = "sure, sending in a bit";
      if (/(assignment|homework|exam)/i.test(lower)) base = "half done 😭 will finish by night";
    } else if (cls === "greeting") {
      base = "hey! what's up?";
    } else if (cls === "invitation") {
      base = "yeah probably, what time?";
    } else if (cls === "request") {
      base = "sure, sending in a bit";
    } else if (cls === "sensitive") {
      base = "let me check and get back to you on this";
    } else if (cls === "work") {
      base = "got it, will update you by EOD";
    } else if (cls === "customer_support" || cls === "complaint") {
      base = "sorry about that, looking into it now";
    } else {
      base = "lol true 😂";
    }

    // Mode adjustments.
    if (mode === "short" || mode === "dry") {
      base = base.split(/[,.]/)[0].trim().toLowerCase();
    }
    if (mode === "funny") base += " 💀";
    if (mode === "flirty") base = base.replace(/what time\?/, "what time? 👀");
    if (mode === "professional") {
      base = base.charAt(0).toUpperCase() + base.slice(1);
      if (!/[.!?]$/.test(base)) base += ".";
    }
    if (mode === "hinglish" && !/(haan|nahi|yaar|bro)/i.test(base)) {
      base = "haan " + base;
    }
    if (mode === "hindi") base = "haan yaar, " + base;
    if (mode === "match_tone" && /!\s*$/.test(req.incomingMessage)) base += "!";

    // Custom instruction: "under N words" is honored.
    const underWords = /under (\d+) words?/i.exec(req.customInstruction ?? "");
    if (underWords) {
      const n = Number(underWords[1]);
      base = base.split(/\s+/).slice(0, n).join(" ");
    }
    if (/remove emojis?/i.test(req.customInstruction ?? "")) {
      base = base.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").trim();
    }
    if (/add emojis?/i.test(req.customInstruction ?? "") && !emoji) {
      base += " 😄";
    }

    // Apply the user's capitalization + punctuation style.
    // Professional mode intentionally overrides the lowercase style so the
    // reply reads formal (capitalized + punctuated, applied above).
    if (tone.capitalization === "lowercase" && mode !== "professional") base = base.toLowerCase();
    if (slang && useEmoji && cls === "casual") base = base.replace(/\.$/, "");

    return base;
  }

  async summarizeConversation(messages: RecentMessage[]): Promise<SummarizationResult> {
    const last = messages[messages.length - 1]?.text ?? "";
    const questions = messages
      .filter((m) => m.sender === "them" && m.text.includes("?"))
      .map((m) => m.text);
    return {
      summary: "Conversation about: " + (last.slice(0, 60) || "chatting"),
      importantFacts: [],
      unansweredQuestions: questions.slice(-2),
      language: /[\u0900-\u097F]/.test(messages.map((m) => m.text).join(" ")) ? "hindi" : "english",
    };
  }

  async analyzeTone(samples: string[]): Promise<Partial<ReplyRequest["toneProfile"]>> {
    void samples;
    return {};
  }

  async classifyMessage(text: string): Promise<ClassificationResult> {
    const classification = classify(text);
    return {
      classification,
      sensitive: classification === "sensitive",
      isQuestion: QUESTION_WORDS.test(text) || text.includes("?"),
      requiresUnknownFacts: /(address|schedule|price|rate|result|score|marks)/i.test(text),
    };
  }

  async createEmbedding(text: string): Promise<number[]> {
    return pseudoEmbedding(text);
  }
}

/** Heuristic helpers reused by the tone engine. */
export { classify as classifyHeuristic, SENSITIVE_HINTS, URGENT_HINTS, estimateTokens };
