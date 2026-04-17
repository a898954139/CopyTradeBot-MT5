import { Router } from "express";
import type { Request, Response } from "express";
import { tradeEventSchema } from "../types.js";
import type { BusinessEvent, RelayResponse, TradeEventPayload } from "../types.js";
import type { DedupService } from "../services/dedup.js";
import type { AuditService } from "../services/audit.js";
import type { TelegramService } from "../services/telegram.js";
import { formatTelegramMessage } from "../formatters/telegram-formatter.js";

interface WebhookDeps {
  readonly dedup: DedupService;
  readonly audit: AuditService;
  readonly telegram: TelegramService;
}

const CLOSE_FAMILY: ReadonlySet<BusinessEvent> = new Set([
  "POSITION_PARTIALLY_CLOSED",
  "POSITION_CLOSED",
  "STOP_LOSS_TRIGGERED",
  "TAKE_PROFIT_TRIGGERED",
]);

// Brokers may split a single close order into multiple fills that arrive
// within milliseconds. Collapse fragments seen on the same position inside
// this window into one Telegram message via editMessageText.
const FRAGMENT_AGGREGATION_WINDOW_SECONDS = 3;

function isCloseFamily(event: BusinessEvent): boolean {
  return CLOSE_FAMILY.has(event);
}

/** Combine a newly arrived close fragment with the already-sent sibling. */
function aggregateCloseFragments(
  sibling: TradeEventPayload,
  incoming: TradeEventPayload,
): TradeEventPayload {
  const combinedVolume = sibling.volume + incoming.volume;

  const weightedPrice =
    combinedVolume > 0
      ? (sibling.price * sibling.volume + incoming.price * incoming.volume) /
        combinedVolume
      : incoming.price;

  // Promote to the more terminal event: CLOSED > *_TRIGGERED > PARTIALLY_CLOSED.
  const rank: Record<BusinessEvent, number> = {
    POSITION_PARTIALLY_CLOSED: 1,
    STOP_LOSS_TRIGGERED: 2,
    TAKE_PROFIT_TRIGGERED: 2,
    POSITION_CLOSED: 3,
  } as unknown as Record<BusinessEvent, number>;
  const finalEventType =
    (rank[incoming.event_type] ?? 0) >= (rank[sibling.event_type] ?? 0)
      ? incoming.event_type
      : sibling.event_type;

  // If the final event is terminal (no position left), express the combined
  // close as the full volume so the formatter renders 100% / no "partial".
  const isTerminal =
    finalEventType === "POSITION_CLOSED" ||
    finalEventType === "STOP_LOSS_TRIGGERED" ||
    finalEventType === "TAKE_PROFIT_TRIGGERED";

  const total_volume = isTerminal ? combinedVolume : incoming.total_volume;

  return {
    ...incoming,
    event_type: finalEventType,
    volume: combinedVolume,
    price: weightedPrice,
    open_price: sibling.open_price || incoming.open_price,
    total_volume,
  };
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

    // Step 4: Broker fragmentation — if a prior close-family event was just
    // sent for this position, edit that message with combined volume/price
    // instead of sending a new one.
    let siblingKey: string | null = null;
    let effectivePayload = payload;
    if (isCloseFamily(payload.event_type) && payload.position_id) {
      const sibling = deps.dedup.findRecentCloseSibling(
        payload.position_id,
        FRAGMENT_AGGREGATION_WINDOW_SECONDS,
      );
      if (sibling) {
        effectivePayload = aggregateCloseFragments(sibling.payload, payload);
        siblingKey = sibling.idempotencyKey;
      }
    }

    // Step 5: For close events, calculate overall P&L including previous partial closes
    let overallProfitable: boolean | null = null;
    if (
      (effectivePayload.event_type === "POSITION_CLOSED" ||
        effectivePayload.event_type === "POSITION_PARTIALLY_CLOSED") &&
      effectivePayload.position_id &&
      effectivePayload.direction
    ) {
      const prevCloses = deps.dedup.getPositionCloses(
        effectivePayload.position_id,
      );
      const dirMul = effectivePayload.direction === "BUY" ? 1 : -1;
      let totalPnL = 0;
      // Sum P&L from previous closes (excluding the sibling we're merging
      // into — its volume is already counted inside effectivePayload).
      for (const prev of prevCloses) {
        if (siblingKey && prev.idempotency_key === siblingKey) continue;
        const entry = prev.open_price ?? prev.price;
        if (entry > 0 && prev.price > 0) {
          totalPnL += (prev.price - entry) * prev.volume * dirMul;
        }
      }
      // Add current close P&L (aggregated)
      const currentEntry = effectivePayload.open_price ?? 0;
      if (currentEntry > 0 && effectivePayload.price > 0) {
        totalPnL +=
          (effectivePayload.price - currentEntry) *
          effectivePayload.volume *
          dirMul;
      }
      if (totalPnL !== 0) {
        overallProfitable = totalPnL > 0;
      }
    }

    // Format and send/edit Telegram message
    const message = formatTelegramMessage(effectivePayload, overallProfitable);
    let messageId: string | undefined;

    try {
      if (siblingKey && payload.position_id) {
        const sibling = deps.dedup.findRecentCloseSibling(
          payload.position_id,
          FRAGMENT_AGGREGATION_WINDOW_SECONDS,
        );
        if (sibling) {
          await deps.telegram.editMessage(sibling.messageId, message);
          messageId = sibling.messageId;
          // Persist aggregated payload on the sibling row so subsequent
          // fragments continue to compound against the combined state.
          deps.dedup.updateAggregatedPayload(sibling.idempotencyKey, {
            ...effectivePayload,
            idempotency_key: sibling.idempotencyKey,
          });
          deps.dedup.updateMessageId(payload.idempotency_key, sibling.messageId);
          deps.audit.log(
            payload.idempotency_key,
            "telegram_edited",
            `sibling=${sibling.idempotencyKey} message_id=${sibling.messageId}`,
          );
        } else {
          // Sibling vanished between the two lookups — fall back to send.
          messageId = await deps.telegram.sendMessage(message);
          deps.dedup.updateMessageId(payload.idempotency_key, messageId);
          deps.audit.log(
            payload.idempotency_key,
            "telegram_sent",
            `message_id=${messageId}`,
          );
        }
      } else {
        messageId = await deps.telegram.sendMessage(message);
        deps.dedup.updateMessageId(payload.idempotency_key, messageId);
        deps.audit.log(
          payload.idempotency_key,
          "telegram_sent",
          `message_id=${messageId}`,
        );
      }
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
