import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/env.js";
import { logger } from "./logger.js";
import { authGuard } from "./auth/guard.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerInstagramAccountRoutes } from "./instagram/routes.js";
import { registerInstagramWebhookRoutes } from "./instagram/webhook.js";
import { registerConversationRoutes } from "./conversations/routes.js";
import { registerToneRoutes } from "./tone/routes.js";
import { registerUserRoutes } from "./users/settingsRoutes.js";
import { registerDiagnosticsRoute } from "./diagnostics.js";
import { closePool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { aiProvider } from "./ai/index.js";
import { notificationProvider } from "./notifications/provider.js";

async function main(): Promise<void> {
  const app = Fastify({
    logger: false,
    // Trust proxy headers (X-Forwarded-For) when behind a reverse proxy.
    trustProxy: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: env.frontendOrigins, credentials: true });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    // Auth endpoints get tighter limits via route config.
  });

  // Health
  app.get("/health", async () => ({
    ok: true,
    service: "toneai-backend",
    time: new Date().toISOString(),
  }));

  await registerDiagnosticsRoute(app);
  await registerAuthRoutes(app);
  await registerInstagramAccountRoutes(app);
  await registerInstagramWebhookRoutes(app);
  await registerConversationRoutes(app);
  await registerToneRoutes(app);
  await registerUserRoutes(app);

  app.setErrorHandler((err, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      logger.error("request failed", { path: request.url, err: err.message });
    }
    void authGuard;
    reply.code(status).send({
      error: status >= 500 ? "internal_error" : "request_error",
      message: status >= 500 ? "Something went wrong" : err.message,
    });
  });

  // Migrate then start.
  const applied = await runMigrations();
  if (applied > 0) logger.info(`applied ${applied} migrations`);

  await app.listen({ port: env.port, host: env.host });
  logger.info(`ToneAI backend listening on ${env.host}:${env.port}`, {
    env: env.nodeEnv,
    aiProvider: aiProvider.name,
    notifications: notificationProvider.name,
  });

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      logger.info("shutting down");
      app.close().finally(() => closePool().finally(() => process.exit(0)));
    });
  }
}

main().catch((err) => {
  logger.error("fatal startup error", { err: String(err) });
  process.exit(1);
});
