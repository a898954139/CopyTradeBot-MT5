import { Router } from "express";
import type { Request, Response } from "express";
import { tradeEventSchema } from "../types.js";
import type { RelayResponse } from "../types.js";
import type { DedupService } from "../services/dedup.js";
import type { AuditService } from "../services/audit.js";
import type { TelegramService } from "../services/telegram.js";
import type { FollowTradeService } from "../services/follow-trade.js";
import { formatTelegramMessage } from "../formatters/telegram-formatter.js";

interface WebhookDeps {
  readonly dedup: DedupService;
  readonly audit: AuditService;
  readonly telegram: TelegramService;
  readonly followTrade: FollowTradeService;
}

export function createWebhookRouter(deps: WebhookDeps): Router {
  const router = Router();

  router.post("/mt5/events", async (req: Request, res: Response) => {
    // Step 1: Validate schema
    const parsed = tradeEventSchema.safeParse(req.body);
    if (!parsed.success) {
      const errorDetail = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");

      deps.audit.log(
        req.body?.idempotency_key ?? "unknown",
        "schema_rejected",
        errorDetail,
      );

      const response: RelayResponse = {
        ok: false,
        duplicate: false,
        accepted: false,
        error: `Schema validation failed: ${errorDetail}`,
      };
      res.status(400).json(response);
      return;
    }

    const payload = parsed.data;

    // Step 2: Dedup check
    const dedupResult = deps.dedup.check(payload.idempotency_key);
    if (dedupResult.isDuplicate) {
      deps.audit.log(payload.idempotency_key, "duplicate_suppressed");

      const response: RelayResponse = {
        ok: true,
        duplicate: true,
        accepted: true,
        message_id: dedupResult.existingMessageId,
      };
      res.status(200).json(response);
      return;
    }

    // Step 3: Record in dedup table (before sending to prevent race)
    try {
      deps.dedup.record(payload);
    } catch (err) {
      // If insert fails due to unique constraint, it's a concurrent duplicate
      deps.audit.log(payload.idempotency_key, "concurrent_duplicate");

      const response: RelayResponse = {
        ok: true,
        duplicate: true,
        accepted: true,
      };
      res.status(200).json(response);
      return;
    }

    // Step 4: Format and send to Telegram
    const message = formatTelegramMessage(payload);
    let messageId: string | undefined;

    try {
      messageId = await deps.telegram.sendMessage(message);
      deps.dedup.updateMessageId(payload.idempotency_key, messageId);
      deps.audit.log(
        payload.idempotency_key,
        "telegram_sent",
        `message_id=${messageId}`,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      deps.audit.log(
        payload.idempotency_key,
        "telegram_failed",
        errorMsg,
      );

      // Event is recorded in dedup — don't re-process on retry.
      // Respond with accepted so EA doesn't re-send.
      const response: RelayResponse = {
        ok: false,
        duplicate: false,
        accepted: true,
        error: "Telegram delivery failed",
      };
      res.status(502).json(response);
      return;
    }

    // Step 5: Follow-trade processing (separate concern, never blocks response)
    try {
      const ftResult = await deps.followTrade.processEvent(payload);
      if (ftResult.processed) {
        deps.audit.log(
          payload.idempotency_key,
          "follow_trade_result",
          `action=${ftResult.action} reason=${ftResult.reason} followPos=${ftResult.followPositionId ?? "n/a"}`,
        );
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      deps.audit.log(
        payload.idempotency_key,
        "follow_trade_error",
        `unhandled: ${errorMsg}`,
      );
    }

    // Step 6: Success response
    const response: RelayResponse = {
      ok: true,
      duplicate: false,
      accepted: true,
      message_id: messageId,
    };
    res.status(200).json(response);
  });

  return router;
}
