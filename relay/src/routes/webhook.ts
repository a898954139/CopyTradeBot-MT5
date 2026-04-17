import { Router } from "express";
import type { Request, Response } from "express";
import { tradeEventSchema } from "../types.js";
import type { RelayResponse } from "../types.js";
import type { DedupService } from "../services/dedup.js";
import type { AuditService } from "../services/audit.js";
import type { TelegramService } from "../services/telegram.js";
import { formatTelegramMessage } from "../formatters/telegram-formatter.js";
import { resolveSticker } from "../formatters/sticker-resolver.js";
import {
  classifyMarketOrderFromHistory,
  type MarketOrderClassification,
} from "../domain/market-order-classifier.js";

interface WebhookDeps {
  readonly dedup: DedupService;
  readonly audit: AuditService;
  readonly telegram: TelegramService;
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
    let marketOrderClassification: MarketOrderClassification | undefined;

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

    if (
      (payload.event_type === "POSITION_OPENED" ||
        payload.event_type === "POSITION_INCREASED") &&
      payload.direction
    ) {
      marketOrderClassification = classifyMarketOrderFromHistory(
        payload,
        deps.dedup.getExecutionHistory(payload.symbol, payload.direction),
      );
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

    // Step 4: For close events, calculate overall P&L including previous partial closes
    let overallProfitable: boolean | null = null;
    if (
      (payload.event_type === "POSITION_CLOSED" ||
        payload.event_type === "POSITION_PARTIALLY_CLOSED") &&
      payload.position_id &&
      payload.direction
    ) {
      const prevCloses = deps.dedup.getPositionCloses(payload.position_id);
      const dirMul = payload.direction === "BUY" ? 1 : -1;
      let totalPnL = 0;
      // Sum P&L from previous closes
      for (const prev of prevCloses) {
        const entry = prev.open_price ?? prev.price;
        if (entry > 0 && prev.price > 0) {
          totalPnL += (prev.price - entry) * prev.volume * dirMul;
        }
      }
      // Add current close P&L
      const currentEntry = payload.open_price ?? 0;
      if (currentEntry > 0 && payload.price > 0) {
        totalPnL += (payload.price - currentEntry) * payload.volume * dirMul;
      }
      if (totalPnL !== 0) {
        overallProfitable = totalPnL > 0;
      }
    }

    // Format and send text message first, then sticker image
    const message = formatTelegramMessage(
      payload,
      overallProfitable,
      marketOrderClassification,
    );
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
      deps.dedup.remove(payload.idempotency_key);
      deps.audit.log(
        payload.idempotency_key,
        "telegram_failed",
        errorMsg,
      );

      // Telegram delivery failed, so remove the dedup record and allow retries.
      const response: RelayResponse = {
        ok: false,
        duplicate: false,
        accepted: false,
        error: "Telegram delivery failed",
      };
      res.status(502).json(response);
      return;
    }

    // Send sticker image after text message (if applicable)
    const stickerResult = resolveSticker(payload, marketOrderClassification);
    if (stickerResult) {
      try {
        await deps.telegram.sendPhoto(stickerResult.filePath, messageId);
        deps.audit.log(
          payload.idempotency_key,
          "sticker_sent",
          `sticker=${stickerResult.name}`,
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        deps.audit.log(
          payload.idempotency_key,
          "sticker_failed",
          `sticker=${stickerResult.name} error=${errorMsg}`,
        );
        // Sticker failure does not block response
      }
    }

    // Step 5: Success response
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
