/**
 * Instagram "Download your information" chat importer.
 *
 * Users download their data from Instagram (official self-service export),
 * then drop the resulting JSON into ToneAI. We parse it LOCALLY on the
 * backend the user owns, learn their tone, and store style examples.
 * No third-party services, no scraping — it is the user's own data.
 *
 * Export shape (instagram/<username>/messages/inbox/<chat>/message_1.json):
 *   [{ "participants": [{ "name": "..." }], "messages": [
 *        { "sender_name": "...", "timestamp_ms": 1700000000000,
 *          "content": "..." /* or shares/reactions etc. *\/ } ] }]
 * Messages are newest-first in the export.
 */
import { query } from "../db/pool.js";
import { audit } from "../audit.js";
import { aiProvider } from "../ai/index.js";
import { logger } from "../logger.js";
import { classifyHeuristic, SENSITIVE_HINTS } from "../ai/mockProvider.js";

export interface ParsedMessage {
  sender: string;
  text: string;
  timestampMs: number;
}

export interface ParsedConversation {
  participants: string[];
  messages: ParsedMessage[];
}

type RawMessage = {
  sender_name?: string;
  timestamp_ms?: number;
  content?: string;
  share?: { share_text?: string };
  is_geoblocked_for_viewer?: boolean;
  blocked_offline_delivery_data?: unknown;
};

type RawConversation = {
  participants?: Array<{ name?: string }>;
  messages?: RawMessage[];
};

/** Decode Instagram export text (UTF-8 bytes misread as latin-1, e.g. hÃ©llo → héllo). */
export function decodeIgText(text: string): string {
  if (!text) return "";
  const looksMojibake = /[\u00c0-\u00ff]/.test(text);
  if (!looksMojibake) return text;
  try {
    const bytes = new Uint8Array([...text].map((c) => c.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    // Only use the decode if it strictly reduced mojibake markers
    // (a lone Ã often maps to another accented char, not a fix).
    const before = (text.match(/[\u00c0-\u00ff]/g) ?? []).length;
    const after = (decoded.match(/[\u00c0-\u00ff]/g) ?? []).length;
    return after < before ? decoded : text;
  } catch {
    return text;
  }
}

/** Parse one message_N.json payload (object with messages, or an array of them). */
export function parseInstagramExport(payload: unknown): ParsedConversation[] {
  const conversations: ParsedConversation[] = [];
  const chunks: RawConversation[] = Array.isArray(payload)
    ? (payload as RawConversation[])
    : payload && typeof payload === "object" && Array.isArray((payload as RawConversation).messages)
      ? [payload as RawConversation]
      : [];

  for (const chunk of chunks) {
    const participants = (chunk.participants ?? [])
      .map((p) => decodeIgText(p.name ?? ""))
      .filter((n) => n.length > 0);
    const messages: ParsedMessage[] = (chunk.messages ?? [])
      .filter((m) => typeof m.content === "string" && m.content.trim().length > 0)
      .filter((m) => !m.is_geoblocked_for_viewer)
      .map((m) => ({
        sender: decodeIgText((m.sender_name ?? "unknown").trim()),
        text: decodeIgText(m.content as string).trim(),
        timestampMs: m.timestamp_ms ?? 0,
      }))
      // Export is newest-first; normalize to oldest-first.
      .reverse();
    if (participants.length > 0 && messages.length > 0) {
      conversations.push({ participants, messages });
    }
  }
  return conversations;
}

const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u2764\uFE0F]/gu;

export interface ToneStats {
  messageCount: number;
  avgMessageLength: number;
  emojiFrequency: number;
  preferredEmojis: string[];
  capitalization: "lowercase" | "standard" | "caps";
  formality: number;
  hinglishUsage: number;
  languages: string[];
  commonSlang: string[];
  asksFollowups: boolean;
}

const HINGLISH_WORDS =
  /\b(yaar|yaar|bhai|bro|matlab|acha|achha|nahi|haan|kya|kaise|kab|kal|abhi|bhi|bas|thoda|bada|chhota|yaar|arre|karo|karta|karti|kar|de|dena|dijiye|hoga|hogi|hai|hain|nahi|nhi|thik|theek|chal|chalo|kya|bakwas|jhalli|masti|padhai|khana|sona|utha|mat|sach|jhoot)\b/gi;

const ENGLISH_WORDS = /\b[a-z']+\b/gi;

function isMostlyLowercase(samples: string[]): boolean {
  let lower = 0;
  let mixed = 0;
  for (const s of samples) {
    const letters = s.replace(/[^a-zA-Z]/g, "");
    if (letters.length < 4) continue;
    if (letters === letters.toLowerCase()) lower++;
    else mixed++;
  }
  return lower > mixed;
}

function topEmojis(samples: string[]): string[] {
  const counts = new Map<string, number>();
  for (const s of samples) {
    for (const e of s.match(EMOJI_RE) ?? []) {
      counts.set(e, (counts.get(e) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([e]) => e);
}

const SLANG_CANDIDATES = [
  "lol", "lmao", "idk", "tbh", "ngl", "fr", "bro", "dude", "yaar", "bhai",
  "omg", "bruh", "sheesh", "vibe", "mood", "sus", "lowkey", "highkey", "deadass", "slay",
];

function topSlang(samples: string[]): string[] {
  const counts = new Map<string, number>();
  for (const s of samples) {
    for (const w of s.toLowerCase().split(/[^a-z']+/)) {
      if (SLANG_CANDIDATES.includes(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
}

/** Compute the user's tone stats from THEIR OWN messages. */
export function computeToneStats(myMessages: string[]): ToneStats {
  const texts = myMessages.filter((t) => t.trim().length > 0);
  const n = texts.length;
  const avgMessageLength = n ? Math.round(texts.reduce((s, t) => s + t.length, 0) / n) : 24;
  const withEmoji = texts.filter((t) => EMOJI_RE.test(t)).length;
  // .test with /g advances lastIndex — recreate regex per use or reset.
  const emojiFrequency = n ? Math.min(1, withEmoji / n) : 0.1;

  const joined = texts.join(" ").toLowerCase();
  const hinglishHits = (joined.match(HINGLISH_WORDS) ?? []).length;
  const englishHits = (joined.match(ENGLISH_WORDS) ?? []).length || 1;
  const hinglishUsage = Math.min(1, hinglishHits / (hinglishHits + englishHits));

  const languages: string[] = [];
  if (englishHits > 0) languages.push("english");
  if (hinglishUsage > 0.05) languages.push("hinglish");
  if (/[\u0900-\u097F]/.test(joined)) languages.push("hindi");

  const questions = texts.filter((t) => t.includes("?")).length;

  return {
    messageCount: n,
    avgMessageLength: Math.max(1, Math.min(500, avgMessageLength)),
    emojiFrequency: Number(emojiFrequency.toFixed(3)),
    preferredEmojis: topEmojis(texts),
    capitalization: isMostlyLowercase(texts) ? "lowercase" : "standard",
    formality: Math.max(0, Math.min(100, Math.round(60 - hinglishUsage * 50 - (isMostlyLowercase(texts) ? 15 : 0)))),
    hinglishUsage: Number(hinglishUsage.toFixed(3)),
    languages: languages.length ? languages : ["english"],
    commonSlang: topSlang(texts),
    asksFollowups: n > 5 ? questions / n > 0.08 : true,
  };
}

/** Find which participant is the user: the export owner. Heuristics:
 *  - The data owner's name is usually NOT the other chat participant(s).
 *  - We accept the account name hint from the caller and fall back to the
 *    participant with the most messages across chats. */
export function pickMyName(conversations: ParsedConversation[], accountHint?: string): string {
  if (accountHint) {
    const hint = accountHint.toLowerCase();
    const all = new Set<string>();
    conversations.forEach((c) => c.participants.forEach((p) => all.add(p.toLowerCase())));
    if (all.has(hint)) return hint;
  }
  const counts = new Map<string, number>();
  for (const c of conversations) {
    for (const m of c.messages) {
      counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1);
    }
  }
  let best = "";
  let bestN = -1;
  for (const [name, n] of counts) {
    if (n > bestN) {
      best = name;
      bestN = n;
    }
  }
  return best;
}

const IMPORT_CAP = 400; // style examples stored per import
const MIN_LEN = 2;
const MAX_LEN = 400;

export interface ImportResult {
  conversations: number;
  totalMessages: number;
  myMessages: number;
  styleExamplesCreated: number;
  learned: ToneStats;
  myName: string;
}

/** Import parsed conversations for a user: learn tone + store style examples. */
export async function importChatsForUser(
  userId: string,
  payload: unknown,
  accountHint?: string,
  igAccountId?: string,
): Promise<ImportResult> {
  const conversations = parseInstagramExport(payload);
  if (conversations.length === 0) {
    throw Object.assign(new Error("no_messages_found: could not find any message JSON in the provided file"), {
      statusCode: 400,
    });
  }

  const myName = pickMyName(conversations, accountHint);
  const myMessages: string[] = [];
  for (const c of conversations) {
    for (const m of c.messages) {
      if (m.sender.toLowerCase() === myName && m.text.length >= MIN_LEN && m.text.length <= MAX_LEN) {
        // Skip obvious sensitive content — never stored as style examples.
        if (SENSITIVE_HINTS.test(m.text.toLowerCase())) continue;
        myMessages.push(m.text);
      }
    }
  }
  if (myMessages.length < 10) {
    throw Object.assign(
      new Error(`not_enough_messages: found ${myMessages.length} of your messages; need at least 10 to learn a tone`),
      { statusCode: 400 },
    );
  }

  const stats = computeToneStats(myMessages);

  // Upsert tone profile with learned values.
  await query(`INSERT INTO tone_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
  await query(
    `UPDATE tone_profiles SET
       avg_message_length = $2,
       emoji_frequency = $3,
       preferred_emojis = $4::text[],
       capitalization = $5,
       formality = $6,
       hinglish_usage = $7,
       languages = $8::text[],
       common_slang = $9::text[],
       asks_followups = $10,
       updated_at = now()
     WHERE user_id = $1`,
    [
      userId,
      stats.avgMessageLength,
      stats.emojiFrequency,
      stats.preferredEmojis,
      stats.capitalization,
      stats.formality,
      stats.hinglishUsage,
      stats.languages,
      stats.commonSlang,
      stats.asksFollowups,
    ],
  );

  // Store style examples (deduped, capped, source=ig_import).
  const seen = new Set<string>();
  const examples: string[] = [];
  for (const t of myMessages) {
    const key = t.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    examples.push(t);
    if (examples.length >= IMPORT_CAP) break;
  }
  let created = 0;
  for (const text of examples) {
    try {
      const embedding = await aiProvider.createEmbedding(text);
      await query(
        `INSERT INTO style_examples (user_id, ig_account_id, text, category, language, tone, embedding, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ig_import')`,
        [
          userId,
          igAccountId ?? null,
          text,
          classifyHeuristic(text),
          stats.languages.includes("hinglish") ? "hinglish" : "english",
          "learned from instagram export",
          JSON.stringify(embedding),
        ],
      );
      created++;
    } catch (err) {
      logger.warn("style example insert failed during import", { err: String(err) });
    }
  }

  await audit(userId, "tone.imported_chats", "tone_profile", undefined, {
    conversations: conversations.length,
    myMessages: myMessages.length,
    examples: created,
  });

  return {
    conversations: conversations.length,
    totalMessages: conversations.reduce((s, c) => s + c.messages.length, 0),
    myMessages: myMessages.length,
    styleExamplesCreated: created,
    learned: stats,
    myName,
  };
}
