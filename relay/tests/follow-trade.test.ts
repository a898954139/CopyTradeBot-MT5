import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../src/db/database.js";
import { AuditService } from "../src/services/audit.js";
import { PositionMappingService } from "../src/services/position-mapping.js";
import { StubMt5ExecutionService } from "../src/services/mt5-execution.js";
import { FollowTradeService } from "../src/services/follow-trade.js";
import type { FollowTradeConfig } from "../src/follow-trade-types.js";
import { buildPayload } from "./helpers.js";
import type Database from "better-sqlite3";

function createFollowTradeService(
  db: Database.Database,
  configOverrides: Partial<FollowTradeConfig> = {},
) {
  const config: FollowTradeConfig = {
    enabled: true,
    lotSize: 0.01,
    ...configOverrides,
  };
  const positionMapping = new PositionMappingService(db);
  const mt5 = new StubMt5ExecutionService();
  const audit = new AuditService(db);
  const service = new FollowTradeService({ config, positionMapping, mt5, audit });
  return { service, mt5, positionMapping, audit };
}

describe("Follow-Trade Service", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  // ── Toggle ──────────────────────────────────────────────────────

  it("should skip when follow trading is disabled", async () => {
    const { service, mt5 } = createFollowTradeService(db, { enabled: false });
    const payload = buildPayload({ event_type: "POSITION_OPENED", magic: 0 });

    const result = await service.processEvent(payload);

    expect(result.processed).toBe(false);
    expect(result.action).toBe("skipped");
    expect(result.reason).toBe("disabled");
    expect(mt5.calls).toHaveLength(0);
  });

  it("should log disabled event in audit", async () => {
    const { service } = createFollowTradeService(db, { enabled: false });
    const payload = buildPayload({ event_type: "POSITION_OPENED", magic: 0 });

    await service.processEvent(payload);

    const logs = db
      .prepare("SELECT * FROM audit_log WHERE action = 'follow_trade_disabled'")
      .all();
    expect(logs).toHaveLength(1);
  });

  // ── Manual trade gate ───────────────────────────────────────────

  it("should skip non-manual trades (magic !== 0)", async () => {
    const { service, mt5 } = createFollowTradeService(db);
    const payload = buildPayload({
      event_type: "POSITION_OPENED",
      magic: 12345,
    });

    const result = await service.processEvent(payload);

    expect(result.processed).toBe(false);
    expect(result.reason).toBe("non-manual");
    expect(mt5.calls).toHaveLength(0);
  });

  // ── Unsupported events ──────────────────────────────────────────

  it("should skip POSITION_CLOSED events", async () => {
    const { service, mt5 } = createFollowTradeService(db);
    const payload = buildPayload({
      event_type: "POSITION_CLOSED",
      magic: 0,
    });

    const result = await service.processEvent(payload);

    expect(result.processed).toBe(false);
    expect(result.reason).toContain("unsupported_event");
    expect(mt5.calls).toHaveLength(0);
  });

  it("should skip PENDING_ORDER_CREATED events", async () => {
    const { service, mt5 } = createFollowTradeService(db);
    const payload = buildPayload({
      event_type: "PENDING_ORDER_CREATED",
      magic: 0,
    });

    const result = await service.processEvent(payload);

    expect(result.processed).toBe(false);
    expect(result.reason).toContain("unsupported_event");
    expect(mt5.calls).toHaveLength(0);
  });

  // ── Successful open ─────────────────────────────────────────────

  it("should open a follow trade for POSITION_OPENED", async () => {
    const { service, mt5 } = createFollowTradeService(db);
    mt5.setOpenResult({ orderId: "follow-ord-1", positionId: "follow-pos-1" });

    const payload = buildPayload({
      event_type: "POSITION_OPENED",
      magic: 0,
      position_id: "src-pos-100",
      symbol: "XAUUSD",
      direction: "BUY",
    });

    const result = await service.processEvent(payload);

    expect(result.processed).toBe(true);
    expect(result.action).toBe("opened");
    expect(result.followPositionId).toBe("follow-pos-1");

    // Verify MT5 was called with correct params — lot size 0.01, no SL/TP
    expect(mt5.calls).toHaveLength(1);
    expect(mt5.calls[0]).toEqual({
      method: "openMarketOrder",
      args: ["XAUUSD", "BUY", 0.01],
    });
  });

  it("should create position mapping on successful open", async () => {
    const { service, mt5, positionMapping } = createFollowTradeService(db);
    mt5.setOpenResult({ orderId: "follow-ord-1", positionId: "follow-pos-1" });

    const payload = buildPayload({
      event_type: "POSITION_OPENED",
      magic: 0,
      position_id: "src-pos-200",
      symbol: "EURUSD",
      direction: "SELL",
    });

    await service.processEvent(payload);

    const mapping = positionMapping.findBySourcePosition("src-pos-200");
    expect(mapping).not.toBeNull();
    expect(mapping!.followPositionId).toBe("follow-pos-1");
    expect(mapping!.symbol).toBe("EURUSD");
    expect(mapping!.direction).toBe("SELL");
    expect(mapping!.status).toBe("open");
  });

  // ── Dedup ───────────────────────────────────────────────────────

  it("should dedup duplicate open events for same position_id", async () => {
    const { service, mt5 } = createFollowTradeService(db);
    mt5.setOpenResult({ orderId: "follow-ord-1", positionId: "follow-pos-1" });

    const payload = buildPayload({
      event_type: "POSITION_OPENED",
      magic: 0,
      position_id: "src-pos-300",
    });

    const result1 = await service.processEvent(payload);
    expect(result1.processed).toBe(true);
    expect(result1.action).toBe("opened");

    // Second call with same position_id
    const result2 = await service.processEvent({
      ...payload,
      idempotency_key: "different-key",
    });
    expect(result2.processed).toBe(false);
    expect(result2.reason).toBe("duplicate_position");

    // MT5 should only have been called once
    expect(mt5.calls).toHaveLength(1);
  });

  // ── SL/TP Update ────────────────────────────────────────────────

  it("should update SL/TP on mapped live follow position", async () => {
    const { service, mt5 } = createFollowTradeService(db);
    mt5.setOpenResult({ orderId: "follow-ord-1", positionId: "follow-pos-1" });

    // First: open the position
    const openPayload = buildPayload({
      event_type: "POSITION_OPENED",
      magic: 0,
      position_id: "src-pos-400",
      symbol: "XAUUSD",
      direction: "BUY",
    });
    await service.processEvent(openPayload);

    // Then: update SL/TP
    const updatePayload = buildPayload({
      event_type: "SL_UPDATED",
      magic: 0,
      position_id: "src-pos-400",
      sl: 3220.0,
      tp: 3260.0,
    });
    const result = await service.processEvent(updatePayload);

    expect(result.processed).toBe(true);
    expect(result.action).toBe("updated");

    // Verify modifyPosition was called
    expect(mt5.calls).toHaveLength(2); // openMarketOrder + modifyPosition
    expect(mt5.calls[1]).toEqual({
      method: "modifyPosition",
      args: ["follow-pos-1", 3220.0, 3260.0],
    });
  });

  it("should update TP on mapped live follow position", async () => {
    const { service, mt5 } = createFollowTradeService(db);
    mt5.setOpenResult({ orderId: "follow-ord-1", positionId: "follow-pos-1" });

    // Open position first
    await service.processEvent(
      buildPayload({
        event_type: "POSITION_OPENED",
        magic: 0,
        position_id: "src-pos-450",
      }),
    );

    // TP update
    const result = await service.processEvent(
      buildPayload({
        event_type: "TP_UPDATED",
        magic: 0,
        position_id: "src-pos-450",
        sl: 0,
        tp: 3280.0,
      }),
    );

    expect(result.processed).toBe(true);
    expect(result.action).toBe("updated");
    expect(mt5.calls[1]!.method).toBe("modifyPosition");
  });

  it("should skip update when no mapping exists", async () => {
    const { service, mt5 } = createFollowTradeService(db);

    const payload = buildPayload({
      event_type: "SL_UPDATED",
      magic: 0,
      position_id: "nonexistent-pos",
      sl: 3220.0,
      tp: 3260.0,
    });

    const result = await service.processEvent(payload);

    expect(result.processed).toBe(false);
    expect(result.reason).toBe("no_mapping");
    expect(mt5.calls).toHaveLength(0);
  });

  it("should skip update when mapping is closed", async () => {
    const { service, mt5, positionMapping } = createFollowTradeService(db);
    mt5.setOpenResult({ orderId: "follow-ord-1", positionId: "follow-pos-1" });

    // Open and then close the mapping
    await service.processEvent(
      buildPayload({
        event_type: "POSITION_OPENED",
        magic: 0,
        position_id: "src-pos-500",
      }),
    );
    positionMapping.markClosed("src-pos-500");

    // Try to update closed position
    const result = await service.processEvent(
      buildPayload({
        event_type: "SL_UPDATED",
        magic: 0,
        position_id: "src-pos-500",
        sl: 3220.0,
        tp: 3260.0,
      }),
    );

    expect(result.processed).toBe(false);
    expect(result.reason).toBe("mapping_status:closed");
    // Only openMarketOrder called, no modifyPosition
    expect(mt5.calls).toHaveLength(1);
  });

  // ── Failure handling ────────────────────────────────────────────

  it("should log error and alert when open execution fails", async () => {
    const { service, mt5 } = createFollowTradeService(db);
    mt5.setFailure(true);

    const payload = buildPayload({
      event_type: "POSITION_OPENED",
      magic: 0,
      position_id: "src-pos-600",
    });

    const result = await service.processEvent(payload);

    expect(result.processed).toBe(false);
    expect(result.reason).toContain("open_failed");

    // Verify ALERT audit log
    const alerts = db
      .prepare("SELECT * FROM audit_log WHERE action = 'follow_trade_failed'")
      .all() as Array<{ detail: string }>;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.detail).toContain("ALERT");
  });

  it("should log error when update execution fails", async () => {
    const { service, mt5 } = createFollowTradeService(db);
    mt5.setOpenResult({ orderId: "follow-ord-1", positionId: "follow-pos-1" });

    // Open successfully first
    await service.processEvent(
      buildPayload({
        event_type: "POSITION_OPENED",
        magic: 0,
        position_id: "src-pos-700",
      }),
    );

    // Now make MT5 fail for updates
    mt5.setFailure(true);

    const result = await service.processEvent(
      buildPayload({
        event_type: "SL_UPDATED",
        magic: 0,
        position_id: "src-pos-700",
        sl: 3220.0,
        tp: 3260.0,
      }),
    );

    expect(result.processed).toBe(false);
    expect(result.reason).toContain("update_failed");

    const alerts = db
      .prepare(
        "SELECT * FROM audit_log WHERE action = 'follow_trade_update_failed'",
      )
      .all() as Array<{ detail: string }>;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.detail).toContain("ALERT");
  });

  // ── Missing position_id ─────────────────────────────────────────

  it("should skip events with null position_id", async () => {
    const { service, mt5 } = createFollowTradeService(db);

    const payload = buildPayload({
      event_type: "POSITION_OPENED",
      magic: 0,
      position_id: null,
    });

    const result = await service.processEvent(payload);

    expect(result.processed).toBe(false);
    expect(result.reason).toBe("missing_position_id");
    expect(mt5.calls).toHaveLength(0);
  });
});
