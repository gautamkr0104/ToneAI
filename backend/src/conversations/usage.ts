/**
 * Usage tracking / cost control. Per-user daily token + generation limits.
 */
import { query } from "../db/pool.js";
import { env } from "../config/env.js";
import { logger } from "../logger.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const usage = {
  async record(
    userId: string,
    promptTokens: number,
    completionTokens: number,
    dailyTokenLimit = env.dailyTokenLimit,
    dailyGenerationLimit = env.dailyGenerationLimit,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const day = today();
    const { rows } = await query<{ prompt_tokens: number; completion_tokens: number; generations: number }>(
      `INSERT INTO usage_records (user_id, day, prompt_tokens, completion_tokens, generations)
       VALUES ($1,$2,$3,$4,1)
       ON CONFLICT (user_id, day) DO UPDATE SET
         prompt_tokens = usage_records.prompt_tokens + $3,
         completion_tokens = usage_records.completion_tokens + $4,
         generations = usage_records.generations + 1,
         updated_at = now()
       RETURNING prompt_tokens, completion_tokens, generations`,
      [userId, day, promptTokens, completionTokens],
    );
    const r = rows[0];
    const totalTokens = r.prompt_tokens + r.completion_tokens;
    if (totalTokens > dailyTokenLimit) {
      logger.warn("daily token limit exceeded", { userId });
      return { allowed: false, reason: "daily_token_limit" };
    }
    if (r.generations > dailyGenerationLimit) {
      logger.warn("daily generation limit exceeded", { userId });
      return { allowed: false, reason: "daily_generation_limit" };
    }
    return { allowed: true };
  },

  async summary(userId: string): Promise<Record<string, unknown>> {
    const day = today();
    const { rows } = await query(
      `SELECT prompt_tokens, completion_tokens, generations FROM usage_records
       WHERE user_id=$1 AND day=$2`,
      [userId, day],
    );
    const { rows: monthRows } = await query(
      `SELECT COALESCE(SUM(prompt_tokens + completion_tokens),0) AS total_tokens,
              COALESCE(SUM(generations),0) AS total_generations
       FROM usage_records WHERE user_id=$1 AND day >= date_trunc('month', CURRENT_DATE)`,
      [userId],
    );
    const r = rows[0] ?? { prompt_tokens: 0, completion_tokens: 0, generations: 0 };
    return {
      today: {
        promptTokens: Number(r.prompt_tokens),
        completionTokens: Number(r.completion_tokens),
        generations: Number(r.generations),
        tokenLimit: env.dailyTokenLimit,
        generationLimit: env.dailyGenerationLimit,
      },
      month: {
        totalTokens: Number(monthRows[0]?.total_tokens ?? 0),
        totalGenerations: Number(monthRows[0]?.total_generations ?? 0),
      },
    };
  },

  /** Check before generation; throws a typed error when over limit. */
  async checkQuota(userId: string): Promise<void> {
    const { rows } = await query<{ prompt_tokens: number; completion_tokens: number; generations: number }>(
      "SELECT prompt_tokens, completion_tokens, generations FROM usage_records WHERE user_id=$1 AND day=$2",
      [userId, today()],
    );
    const r = rows[0];
    if (r) {
      if (r.prompt_tokens + r.completion_tokens >= env.dailyTokenLimit) {
        throw new Error("quota_exceeded: daily token limit reached");
      }
      if (r.generations >= env.dailyGenerationLimit) {
        throw new Error("quota_exceeded: daily generation limit reached");
      }
    }
  },
};
