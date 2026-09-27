/**
 * AIProvider abstraction. Swap providers (OpenAI, Anthropic, local LLM) via
 * env config without touching business logic. All AI runs on the backend
 * only; the Android app never bundles a model.
 */
export type MessageClass =
  | "greeting"
  | "question"
  | "casual"
  | "request"
  | "invitation"
  | "flirting"
  | "work"
  | "customer_support"
  | "complaint"
  | "sensitive"
  | "unknown";

export const SENSITIVE_CLASSES: ReadonlySet<MessageClass> = new Set([
  "sensitive",
] as const);

export type ReplyMode =
  | "normal" | "casual" | "funny" | "flirty" | "professional" | "friendly"
  | "dry" | "short" | "detailed" | "hindi" | "hinglish" | "english"
  | "match_tone";

export const REPLY_MODES: readonly ReplyMode[] = [
  "normal", "casual", "funny", "flirty", "professional", "friendly",
  "dry", "short", "detailed", "hindi", "hinglish", "english", "match_tone",
] as const;

export interface ToneProfileData {
  avgMessageLength: number;
  formality: number; // 0..100
  emojiFrequency: number; // 0..1
  preferredEmojis: string[];
  commonSlang: string[];
  commonPhrases: string[];
  punctuationStyle: string;
  capitalization: string;
  humorLevel: number; // 0..100
  languages: string[];
  hinglishUsage: number; // 0..1
  asksFollowups: boolean;
  mirrorsTone: boolean;
  notes?: string;
}

export interface StyleExampleData {
  text: string;
  category?: string;
  language?: string;
  tone?: string;
  similarity?: number;
}

export interface MemoryData {
  summary: string;
  importantFacts: string[];
  unansweredQuestions: string[];
  language?: string;
  toneContext?: string;
}

export interface RecentMessage {
  sender: "them" | "me";
  text: string;
}

export interface ReplyRequest {
  incomingMessage: string;
  recentMessages: RecentMessage[];
  toneProfile: ToneProfileData;
  styleExamples: StyleExampleData[];
  memory?: MemoryData;
  replyMode: ReplyMode;
  customInstruction?: string;
}

export interface ReplyResponse {
  reply: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface ClassificationResult {
  classification: MessageClass;
  sensitive: boolean;
  isQuestion: boolean;
  requiresUnknownFacts: boolean;
}

export interface SummarizationResult {
  summary: string;
  importantFacts: string[];
  unansweredQuestions: string[];
  language: string;
}

export interface UsageReport {
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export interface AIProvider {
  readonly name: string;
  generateReply(req: ReplyRequest): Promise<ReplyResponse>;
  summarizeConversation(messages: RecentMessage[]): Promise<SummarizationResult>;
  analyzeTone(samples: string[]): Promise<Partial<ToneProfileData>>;
  classifyMessage(text: string): Promise<ClassificationResult>;
  createEmbedding(text: string): Promise<number[]>;
}
