import dotenv from "dotenv";
dotenv.config();

function str(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}
function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number`);
  return n;
}
function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: (process.env.NODE_ENV ?? "development") === "production",
  port: int("PORT", 8080),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: str(
    "DATABASE_URL",
    "postgres://toneai:toneai@localhost:5432/toneai",
  ),
  redisUrl: process.env.REDIS_URL,
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:8080",
  frontendOrigins: (process.env.FRONTEND_ORIGINS ?? "*").split(","),

  jwtAccessSecret:
    process.env.JWT_ACCESS_SECRET ?? "dev-only-access-secret-change-me",
  jwtRefreshSecret:
    process.env.JWT_REFRESH_SECRET ?? "dev-only-refresh-secret-change-me",
  accessTokenTtl: int("ACCESS_TOKEN_TTL_SECONDS", 900),
  refreshTokenTtl: int("REFRESH_TOKEN_TTL_SECONDS", 60 * 60 * 24 * 30),

  instagramAppId: process.env.INSTAGRAM_APP_ID,
  instagramAppSecret: process.env.INSTAGRAM_APP_SECRET,
  instagramWebhookVerifyToken:
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN ?? "dev-verify-token",
  instagramGraphVersion: process.env.INSTAGRAM_GRAPH_VERSION ?? "v21.0",

  aiProvider: process.env.AI_PROVIDER ?? "openai",
  openAiApiKey: process.env.OPENAI_API_KEY,
  aiFastModel: process.env.AI_FAST_MODEL ?? "gpt-4o-mini",
  aiReplyModel: process.env.AI_REPLY_MODEL ?? "gpt-4o-mini",

  notificationProvider: process.env.NOTIFICATION_PROVIDER ?? "noop",
  fcmServerKey: process.env.FCM_SERVER_KEY,

  dailyTokenLimit: int("DAILY_TOKEN_LIMIT", 200_000),
  dailyGenerationLimit: int("DAILY_GENERATION_LIMIT", 300),

  logMessageContent: bool("LOG_MESSAGE_CONTENT", false),
  seedDemoToken: process.env.SEED_DEMO_TOKEN,
} as const;
