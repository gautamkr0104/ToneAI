import { describe, it, expect } from "vitest";
import {
  parseInstagramExport,
  computeToneStats,
  pickMyName,
  decodeIgText,
} from "../src/tone/importChats.js";

function conversation(myName: string, otherName: string, pairs: Array<[string, string]>) {
  return {
    participants: [{ name: myName }, { name: otherName }],
    messages: pairs
      .map(([sender, content], i) => ({
        sender_name: sender,
        content,
        timestamp_ms: 1_700_000_000_000 + (pairs.length - i) * 1000,
      }))
      .reverse(), // export order is newest-first
  };
}

describe("Instagram export parser", () => {
  it("parses a single message_N.json object with newest-first messages", () => {
    const payload = conversation("me", "friend", [
      ["friend", "hello there"],
      ["me", "hey! what's up?"],
    ]);
    const parsed = parseInstagramExport(payload);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].participants).toEqual(["me", "friend"]);
    expect(parsed[0].messages.map((m) => m.sender)).toEqual(["friend", "me"]);
  });

  it("parses an array of chunks (multiple message_N.json files concatenated)", () => {
    const payload = [
      conversation("me", "a", [["me", "one"]]),
      conversation("me", "b", [["me", "two"]]),
    ];
    const parsed = parseInstagramExport(payload);
    expect(parsed).toHaveLength(2);
  });

  it("skips non-text messages and geoblocked entries", () => {
    const payload = {
      participants: [{ name: "me" }, { name: "x" }],
      messages: [
        { sender_name: "me", timestamp_ms: 1, share: { share_text: "sticker" } },
        { sender_name: "me", timestamp_ms: 2, content: "visible", is_geoblocked_for_viewer: true },
        { sender_name: "me", timestamp_ms: 3, content: "ok" },
      ],
    };
    const parsed = parseInstagramExport(payload);
    expect(parsed[0].messages).toHaveLength(1);
    expect(parsed[0].messages[0].text).toBe("ok");
  });

  it("repairs latin-1 mojibake from the official export", () => {
    // Real IG exports: UTF-8 bytes read as latin-1 → "héllo" arrives as "hÃÂ©llo"-style.
    // "hÃ©llo" alone is ambiguous (Ã could be a legit char), but a full second
    // misencode round ("hÃÂ©llo") always decodes cleanly to "hÃ©llo" then "héllo".
    const fixed = decodeIgText("h\u00c3\u0083\u00c2\u00a9llo");
    expect(fixed).toBe("h\u00c3\u00a9llo"); // recovers one level: hÃ©llo
    expect(decodeIgText("plain text")).toBe("plain text");
  });
});

describe("tone learner", () => {
  const myMsgs = [
    "yeah bro idk 😭",
    "lol that's so random 😂😂",
    "bhai kya scene hai",
    "lol ok",
    "bro this is unreal 😂",
    "haan chal theek hai",
    "idk man, sounds sus tbh",
    "lol 😭",
    "kya matlab",
    "bro bro bro 😂",
    "acha acha",
    "fr fr that's wild",
  ];

  it("computes lowercase + emoji-heavy stats", () => {
    const s = computeToneStats(myMsgs);
    expect(s.messageCount).toBe(12);
    expect(s.capitalization).toBe("lowercase");
    expect(s.emojiFrequency).toBeGreaterThan(0.2);
    expect(s.preferredEmojis.length).toBeGreaterThan(0);
    expect(s.commonSlang).toContain("lol");
    expect(s.commonSlang).toContain("bro");
    expect(s.languages).toContain("english");
    expect(s.hinglishUsage).toBeGreaterThan(0);
  });

  it("detects standard capitalization", () => {
    const s = computeToneStats([
      "This is a formal sentence.",
      "Another properly capitalized message.",
      "Yes, I do write like this often.",
      "Standard capitalization it is.",
    ]);
    expect(s.capitalization).toBe("standard");
    expect(s.formality).toBeGreaterThan(30);
  });

  it("picks the most active sender as the export owner without a hint", () => {
    const convs = parseInstagramExport(
      conversation("me", "friend", [
        ["friend", "hi"],
        ["me", "sup"],
        ["me", "not much"],
      ]),
    );
    expect(pickMyName(convs)).toBe("me");
  });

  it("prefers the account hint when present", () => {
    const convs = parseInstagramExport(
      conversation("gautam", "friend", [
        ["friend", "hi"],
        ["gautam", "hello"],
      ]),
    );
    expect(pickMyName(convs, "Gautam")).toBe("gautam");
  });
});
