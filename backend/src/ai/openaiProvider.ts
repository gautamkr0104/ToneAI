/**
 * OpenAI-backed AIProvider. Only used server-side; the key lives in backend
 * env config and is never shipped to any client.
 */
import type {
  AIProvider,
  ClassificationResult,
  MessageClass,
  ReplyRequest,
  ReplyResponse,
  RecentMessage,
  SummarizationResult,
  ToneProfileData,
} from "./provider.js";
import { env } from "../config/env.js";
import { logger } from "../logger.js";
import { pseudoEmbedding } from "../crypto.js";
import { classifyHeuristic } from "./mockProvider.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  private async chat(
    messages: ChatMessage[],
    model: string,
    maxTokens: number,
  ): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
    const res = await this.fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.openAiApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.9,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error("openai request failed", { status: res.status, body: body.slice(0, 200) });
      throw new Error("openai_error_" + res.status);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    };
  }

  async generateReply(req: ReplyRequest): Promise<ReplyResponse> {
    const tone = req.toneProfile;
    const systemLines: string[] = [
      "You write Instagram DM replies that sound exactly like the user would sound.",
      "GOAL: 'Write the message I would naturally send.' NOT 'Write the most grammatically correct response.'",
      "PRESERVE the user's slang, abbreviations, lowercase style, punctuation habits, emoji habits, Hindi/Hinglish patterns and typical message length.",
      "NEVER fabricate facts about the user. If you do not know an answer, keep the reply vague or ask.",
      "Do not use corporate or assistant language (no 'I understand', 'I would be happy to', etc.) unless the user genuinely writes that way.",
      "Reply with ONLY the message text — no quotes, no explanations, no prefixes.",
    ];
    if (tone.capitalization === "lowercase") systemLines.push("The user almost always types in lowercase. Keep it lowercase.");
    if (tone.emojiFrequency > 0.3) systemLines.push("The user uses emojis frequently (" + tone.preferredEmojis.join(" ") + "). Use them naturally.");
    else if (tone.emojiFrequency < 0.05) systemLines.push("The user rarely uses emojis. Do not add any.");
    if (tone.hinglishUsage > 0.3) systemLines.push("The user often mixes Hindi and English (Hinglish). Match that naturally.");
    if (tone.asksFollowups) systemLines.push("The user often ends replies with a short follow-up question.");
    if (tone.mirrorsTone) systemLines.push("Mirror the other person's energy and tone.");
    if (tone.notes) systemLines.push("Additional user notes: " + tone.notes);

    const modeHints: Record<string, string> = {
      normal: "Standard reply, exactly like the user.",
      casual: "Extra casual and relaxed.",
      funny: "Add light humor the way the user would.",
      flirty: "Playful and flirty but respectful.",
      professional: "Polite and professional; this is a work/formal contact.",
      friendly: "Warm and friendly.",
      dry: "Dry, minimal words, low energy.",
      short: "Very short (under 8 words if possible).",
      detailed: "Slightly longer and more detailed.",
      hindi: "Reply in Hindi (Devanagari or romanized as the user does).",
      hinglish: "Reply in Hinglish (Hindi words in Latin script mixed with English).",
      english: "Reply in English.",
      match_tone: "Match the other person's tone and energy exactly.",
    };
    systemLines.push("MODE: " + (modeHints[req.replyMode] ?? modeHints.normal));
    if (req.customInstruction) systemLines.push("USER INSTRUCTION (highest priority): " + req.customInstruction);

    const messages: ChatMessage[] = [{ role: "system", content: systemLines.join("\n") }];

    const contextParts: string[] = [];
    if (req.memory?.summary) contextParts.push("Conversation so far: " + req.memory.summary);
    if (req.memory?.importantFacts?.length) contextParts.push("Facts: " + req.memory.importantFacts.join("; "));
    if (req.memory?.unansweredQuestions?.length) {
      contextParts.push("Their unanswered questions: " + req.memory.unansweredQuestions.join("; "));
    }
    if (contextParts.length) messages.push({ role: "system", content: contextParts.join("\n") });

    if (req.styleExamples.length) {
      messages.push({
        role: "system",
        content:
          "Examples of how THIS USER writes (imitate this style closely):\n" +
          req.styleExamples.map((e) => "- " + e.text).join("\n"),
      });
    }

    if (req.recentMessages.length) {
      messages.push({
        role: "system",
        content:
          "Recent conversation:\n" +
          req.recentMessages
            .map((m) => (m.sender === "me" ? "Me: " : "Them: ") + m.text)
            .join("\n"),
      });
    }

    messages.push({
      role: "user",
      content:
        "New message from " +
        "them" +
        ': "' +
        req.incomingMessage +
        '"\nWrite my reply in my exact style.',
    });

    const out = await this.chat(messages, env.aiReplyModel, 200);
    let reply = out.text.trim().replace(/^["']|["']$/g, "");
    return {
      reply,
      model: env.aiReplyModel,
      promptTokens: out.promptTokens,
      completionTokens: out.completionTokens,
    };
  }

  async summarizeConversation(messages: RecentMessage[]): Promise<SummarizationResult> {
    const res = await this.chat(
      [
        {
          role: "system",
          content:
            "Summarize this DM conversation in <=2 sentences. List up to 5 important facts the user stated about themselves (never sensitive inferences), and any unanswered questions from the other person. Output JSON: {\"summary\":\"...\",\"importantFacts\":[],\"unansweredQuestions\":[],\"language\":\"english|hindi|hinglish\"}",
        },
        {
          role: "user",
          content: messages.map((m) => (m.sender === "me" ? "Me: " : "Them: ") + m.text).join("\n"),
        },
      ],
      env.aiFastModel,
      300,
    );
    try {
      return JSON.parse(res.text) as SummarizationResult;
    } catch {
      return {
        summary: res.text.slice(0, 200),
        importantFacts: [],
        unansweredQuestions: [],
        language: "english",
      };
    }
  }

  async analyzeTone(samples: string[]): Promise<Partial<ToneProfileData>> {
    if (!samples.length) return {};
    const res = await this.chat(
      [
        {
          role: "system",
          content:
            "Analyze the texting style of these messages. Output JSON only: {\"avgMessageLength\":number,\"formality\":0-100,\"emojiFrequency\":0-1,\"preferredEmojis\":[],\"commonSlang\":[],\"commonPhrases\":[],\"punctuationStyle\":\"minimal|heavy|standard\",\"capitalization\":\"lowercase|standard|caps\",\"humorLevel\":0-100,\"languages\":[],\"hinglishUsage\":0-1,\"asksFollowups\":boolean,\"mirrorsTone\":boolean}",
        },
        { role: "user", content: samples.slice(0, 100).join("\n") },
      ],
      env.aiFastModel,
      400,
    );
    try {
      return JSON.parse(res.text) as Partial<ToneProfileData>;
    } catch {
      return {};
    }
  }

  async classifyMessage(text: string): Promise<ClassificationResult> {
    // Cheap classification via fast model, with heuristic fallback.
    try {
      const res = await this.chat(
        [
          {
            role: "system",
            content:
              'Classify this DM into exactly one category: greeting, question, casual, request, invitation, flirting, work, customer_support, complaint, sensitive, unknown. Also report if it is a question, contains sensitive topics, or seems to require factual information you cannot know. Output JSON: {"classification":"...","sensitive":bool,"isQuestion":bool,"requiresUnknownFacts":bool}',
          },
          { role: "user", content: text },
        ],
        env.aiFastModel,
        80,
      );
      const parsed = JSON.parse(res.text) as Partial<ClassificationResult>;
      return {
        classification: (parsed.classification ?? classifyHeuristic(text)) as MessageClass,
        sensitive: parsed.sensitive ?? false,
        isQuestion: parsed.isQuestion ?? text.includes("?"),
        requiresUnknownFacts: parsed.requiresUnknownFacts ?? false,
      };
    } catch {
      return {
        classification: classifyHeuristic(text),
        sensitive: SENSITIVE_FALLBACK(text),
        isQuestion: text.includes("?"),
        requiresUnknownFacts: false,
      };
    }
  }

  async createEmbedding(text: string): Promise<number[]> {
    try {
      const res = await this.fetchFn("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.openAiApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 2000) }),
      });
      if (!res.ok) throw new Error("embed_error_" + res.status);
      const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
      if (json.data?.[0]?.embedding) return json.data[0].embedding;
      throw new Error("no_embedding");
    } catch (err) {
      logger.warn("embedding fallback to local", { err: String(err) });
      return pseudoEmbedding(text);
    }
  }
}

function SENSITIVE_FALLBACK(text: string): boolean {
  return /(password|otp|cvv|bank|suicide|kill|threat|medical|legal)/i.test(text);
}
