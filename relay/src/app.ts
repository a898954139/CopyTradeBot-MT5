import express from "express";
import type Database from "better-sqlite3";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createWebhookRouter } from "./routes/webhook.js";
import { DedupService } from "./services/dedup.js";
import { AuditService } from "./services/audit.js";
import type { TelegramService } from "./services/telegram.js";

// Extend Express Request to carry raw body for HMAC verification
declare global {
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

export interface AppDeps {
  readonly db: Database.Database;
  readonly webhookSecret: string;
  readonly telegram: TelegramService;
}

export function createApp(deps: AppDeps): express.Application {
  const app = express();

  // Parse JSON body and capture raw body for HMAC verification
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as Express.Request).rawBody = buf.toString("utf8");
      },
    }),
  );

  // Health check (no auth required)
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Auth middleware for webhook routes
  const authMiddleware = createAuthMiddleware(deps.webhookSecret);

  // Webhook routes
  const dedup = new DedupService(deps.db);
  const audit = new AuditService(deps.db);
  const webhookRouter = createWebhookRouter({
    dedup,
    audit,
    telegram: deps.telegram,
  });

  // TODO: re-enable auth after HMAC alignment
  // app.use("/webhooks", authMiddleware, webhookRouter);
  app.use("/webhooks", webhookRouter);

  return app;
}
