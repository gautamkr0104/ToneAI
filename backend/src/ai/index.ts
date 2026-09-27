import { env } from "../config/env.js";
import type { AIProvider } from "./provider.js";
import { MockAIProvider } from "./mockProvider.js";
import { OpenAIProvider } from "./openaiProvider.js";

export function createAIProvider(): AIProvider {
  if (env.aiProvider === "openai" && env.openAiApiKey) {
    return new OpenAIProvider();
  }
  return new MockAIProvider();
}

/** Process-wide AI provider singleton (openai when configured, else mock). */
export const aiProvider: AIProvider = createAIProvider();
