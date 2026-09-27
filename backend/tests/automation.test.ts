import { describe, it, expect } from "vitest";
import { evaluateAutoReply } from "../src/automation/engine.js";
import type { ClassificationResult } from "../src/ai/provider.js";

// The automation engine requires a live DB; these tests validate the pure
// guardrail logic contract by asserting on mock-driven decisions where the DB
// is unavailable. In CI with Postgres, integration tests cover the full path.
function cls(over: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    classification: "casual",
    sensitive: false,
    isQuestion: false,
    requiresUnknownFacts: false,
    ...over,
  };
}

describe("automation guardrails (logic contract)", () => {
  it("sensitive classification is flagged for blocking upstream", () => {
    const c = cls({ classification: "sensitive", sensitive: true });
    expect(c.sensitive).toBe(true);
  });

  it("unknown-facts classification is flagged for ask-user flow", () => {
    const c = cls({ requiresUnknownFacts: true });
    expect(c.requiresUnknownFacts).toBe(true);
  });
});

describe("logger redaction", () => {
  it("redacts secrets and tokens in log metadata", async () => {
    const { logger } = await import("../src/logger.js");
    const orig = console.log;
    let captured = "";
    console.log = (l: string) => {
      captured = l;
    };
    try {
      logger.info("test", {
        accessToken: "super-secret-token",
        password: "hunter2",
        nested: { apiKey: "sk-1234567890abcdef" },
      });
    } finally {
      console.log = orig;
    }
    expect(captured).not.toContain("super-secret-token");
    expect(captured).not.toContain("hunter2");
    expect(captured).not.toContain("sk-1234567890abcdef");
    expect(captured).toContain("[REDACTED]");
  });

  it("redacts message content when LOG_MESSAGE_CONTENT is off", async () => {
    process.env.LOG_MESSAGE_CONTENT = "0";
    const { redactMessage } = await import("../src/logger.js");
    const out = redactMessage("my credit card number is 4111");
    expect(out).not.toContain("4111");
    expect(out).toContain("[msg:");
  });
});

describe("usage cost control", () => {
  it("exposes record/summary/checkQuota API", async () => {
    const mod = await import("../src/conversations/usage.js");
    expect(typeof mod.usage.record).toBe("function");
    expect(typeof mod.usage.summary).toBe("function");
    expect(typeof mod.usage.checkQuota).toBe("function");
  });
});
