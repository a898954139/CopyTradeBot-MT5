import type { TradeEventPayload } from "../types.js";
import type {
  FollowTradeConfig,
  FollowTradeResult,
} from "../follow-trade-types.js";
import type { PositionMappingService } from "./position-mapping.js";
import type { Mt5ExecutionService } from "./mt5-execution.js";
import type { AuditService } from "./audit.js";

const FOLLOW_TRADE_EVENTS = new Set([
  "POSITION_OPENED",
  "SL_UPDATED",
  "TP_UPDATED",
]);

function isManualTrade(payload: TradeEventPayload): boolean {
  return payload.magic === 0;
}

export class FollowTradeService {
  private readonly config: FollowTradeConfig;
  private readonly positionMapping: PositionMappingService;
  private readonly mt5: Mt5ExecutionService;
  private readonly audit: AuditService;

  constructor(deps: {
    readonly config: FollowTradeConfig;
    readonly positionMapping: PositionMappingService;
    readonly mt5: Mt5ExecutionService;
    readonly audit: AuditService;
  }) {
    this.config = deps.config;
    this.positionMapping = deps.positionMapping;
    this.mt5 = deps.mt5;
    this.audit = deps.audit;
  }

  async processEvent(payload: TradeEventPayload): Promise<FollowTradeResult> {
    const positionId = payload.position_id ?? "unknown";

    // Gate 1: toggle check
    if (!this.config.enabled) {
      this.audit.log(
        payload.idempotency_key,
        "follow_trade_disabled",
        `event=${payload.event_type} position=${positionId}`,
      );
      return { processed: false, action: "skipped", reason: "disabled" };
    }

    // Gate 2: only manual trades
    if (!isManualTrade(payload)) {
      this.audit.log(
        payload.idempotency_key,
        "follow_trade_skipped",
        `non-manual trade magic=${payload.magic} position=${positionId}`,
      );
      return { processed: false, action: "skipped", reason: "non-manual" };
    }

    // Gate 3: only supported event types
    if (!FOLLOW_TRADE_EVENTS.has(payload.event_type)) {
      this.audit.log(
        payload.idempotency_key,
        "follow_trade_skipped",
        `unsupported event=${payload.event_type} position=${positionId}`,
      );
      return {
        processed: false,
        action: "skipped",
        reason: `unsupported_event:${payload.event_type}`,
      };
    }

    // Gate 4: must have position_id
    if (!payload.position_id) {
      this.audit.log(
        payload.idempotency_key,
        "follow_trade_skipped",
        "missing position_id",
      );
      return {
        processed: false,
        action: "skipped",
        reason: "missing_position_id",
      };
    }

    if (payload.event_type === "POSITION_OPENED") {
      return this.handleOpen(payload);
    }

    return this.handleUpdate(payload);
  }

  private async handleOpen(
    payload: TradeEventPayload,
  ): Promise<FollowTradeResult> {
    const sourcePositionId = payload.position_id!;

    // Dedup: check if we already have a mapping for this position
    const existing =
      this.positionMapping.findBySourcePosition(sourcePositionId);
    if (existing) {
      this.audit.log(
        payload.idempotency_key,
        "follow_trade_dedup",
        `position=${sourcePositionId} already mapped to ${existing.followPositionId}`,
      );
      return {
        processed: false,
        action: "skipped",
        reason: "duplicate_position",
      };
    }

    // Create pending mapping
    this.positionMapping.create({
      sourcePositionId,
      symbol: payload.symbol,
      direction: payload.direction ?? "BUY",
    });

    // Execute market order on follow account — NO SL/TP
    try {
      const result = await this.mt5.openMarketOrder(
        payload.symbol,
        (payload.direction as "BUY" | "SELL") ?? "BUY",
        this.config.lotSize,
      );

      // Update mapping with follow position
      this.positionMapping.updateFollowPosition(
        sourcePositionId,
        result.positionId,
      );

      this.audit.log(
        payload.idempotency_key,
        "follow_trade_opened",
        `source=${sourcePositionId} follow=${result.positionId} symbol=${payload.symbol} dir=${payload.direction} lot=${this.config.lotSize}`,
      );

      return {
        processed: true,
        action: "opened",
        reason: "success",
        followPositionId: result.positionId,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.audit.log(
        payload.idempotency_key,
        "follow_trade_failed",
        `ALERT: open failed for position=${sourcePositionId} error=${errorMsg}`,
      );
      return { processed: false, action: "skipped", reason: `open_failed:${errorMsg}` };
    }
  }

  private async handleUpdate(
    payload: TradeEventPayload,
  ): Promise<FollowTradeResult> {
    const sourcePositionId = payload.position_id!;

    // Look up mapping
    const mapping =
      this.positionMapping.findBySourcePosition(sourcePositionId);

    if (!mapping || mapping.status !== "open") {
      const reason = !mapping ? "no_mapping" : `mapping_status:${mapping.status}`;
      this.audit.log(
        payload.idempotency_key,
        "follow_trade_update_skipped",
        `position=${sourcePositionId} reason=${reason}`,
      );
      return { processed: false, action: "skipped", reason };
    }

    try {
      await this.mt5.modifyPosition(
        mapping.followPositionId!,
        payload.sl,
        payload.tp,
      );

      this.audit.log(
        payload.idempotency_key,
        "follow_trade_updated",
        `source=${sourcePositionId} follow=${mapping.followPositionId} SL=${payload.sl} TP=${payload.tp}`,
      );

      return {
        processed: true,
        action: "updated",
        reason: "success",
        followPositionId: mapping.followPositionId ?? undefined,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.audit.log(
        payload.idempotency_key,
        "follow_trade_update_failed",
        `ALERT: update failed for position=${sourcePositionId} follow=${mapping.followPositionId} error=${errorMsg}`,
      );
      return {
        processed: false,
        action: "skipped",
        reason: `update_failed:${errorMsg}`,
      };
    }
  }
}
