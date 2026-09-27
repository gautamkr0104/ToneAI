import { describe, it, expect } from "vitest";
import { MockAIProvider, classifyHeuristic } from "../src/ai/mockProvider.js";
import type { ReplyRequest, ToneProfileData } from "../src/ai/provider.js";

function baseTone(): ToneProfileData {
  return {
    avgMessageLength: 12,
    formality: 10,
    emojiFrequency: 0.3,
    preferredEmojis: ["😭", "😂"],
    commonSlang: ["bro"],
    commonPhrases: [],
    punctuationStyle: "minimal",
    capitalization: "lowercase",
    humorLevel: 60,
    languages: ["english", "hinglish"],
    hinglishUsage: 0.4,
    asksFollowups: true,
    mirrorsTone: true,
  };
}

function baseReq(overrides: Partial<ReplyRequest> = {}): ReplyRequest {
  return {
    incomingMessage: "yo are you coming tonight?",
    recentMessages: [
      { sender: "them", text: "hey" },
      { sender: "me", text: "yo" },
    ],
    toneProfile: baseTone(),
    styleExamples: [{ text: "yeah bro idk 😭", similarity: 0.9 }],
    replyMode: "normal",
    ...overrides,
  };
}

describe("MockAIProvider classification", () => {
  const ai = new MockAIProvider();

  it("classifies questions", async () => {
    const r = await ai.classifyMessage("are you coming tonight?");
    expect(r.classification).toBe("question");
    expect(r.isQuestion).toBe(true);
  });

  it("classifies greetings", async () => {
    const r = await ai.classifyMessage("hey");
    expect(r.classification).toBe("greeting");
  });

  it("flags sensitive content", async () => {
    const r = await ai.classifyMessage("hey what's your bank password");
    expect(r.classification).toBe("sensitive");
    expect(r.sensitive).toBe(true);
  });

  it("classifies work messages", async () => {
    const r = await ai.classifyMessage("the client meeting is at 3, send the report");
    expect(r.classification).toBe("work");
  });

  it("classifies invitations", async () => {
    const r = await ai.classifyMessage("party at my place this weekend, coming?");
    expect(r.classification).toBe("invitation");
  });

  it("detects unknown-fact requirements", async () => {
    const r = await ai.classifyMessage("what's your address?");
    expect(r.requiresUnknownFacts).toBe(true);
  });
});

describe("MockAIProvider natural tone", () => {
  const ai = new MockAIProvider();

  it("keeps replies lowercase for lowercase users", async () => {
    const r = await ai.generateReply(baseReq());
    expect(r.reply).toBe(r.reply.toLowerCase());
  });

  it("respects 'under N words' custom instruction", async () => {
    const r = await ai.generateReply(
      baseReq({ customInstruction: "Make this sound like me but keep it under 8 words." }),
    );
    expect(r.reply.split(/\s+/).length).toBeLessThanOrEqual(8);
  });

  it("can remove emojis on instruction", async () => {
    const r = await ai.generateReply(
      baseReq({ replyMode: "funny", customInstruction: "remove emojis" }),
    );
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(r.reply)).toBe(false);
  });

  it("professional mode capitalizes and punctuates", async () => {
    const r = await ai.generateReply(baseReq({ replyMode: "professional" }));
    expect(r.reply[0]).toBe(r.reply[0]!.toUpperCase());
  });

  it("hinglish mode adds hinglish flavor", async () => {
    const r = await ai.generateReply(baseReq({ replyMode: "hinglish" }));
    expect(r.reply.length).toBeGreaterThan(0);
  });

  it("dry mode shortens", async () => {
    const r = await ai.generateReply(baseReq({ replyMode: "dry" }));
    expect(r.reply.split(/\s+/).length).toBeLessThanOrEqual(5);
  });

  it("reports token usage", async () => {
    const r = await ai.generateReply(baseReq());
    expect(r.promptTokens).toBeGreaterThan(0);
    expect(r.completionTokens).toBeGreaterThan(0);
  });
});

describe("heuristic classifier", () => {
  it("maps messages to categories", () => {
    expect(classifyHeuristic("hello!")).toBe("greeting");
    expect(classifyHeuristic("where is my refund??")).toBe("customer_support");
    expect(classifyHeuristic("omg that movie was terrible")).toBe("complaint");
    expect(classifyHeuristic("yo what's up")).toBe("greeting");
    expect(classifyHeuristic("random thoughts lol")).toBe("casual");
  });
});
