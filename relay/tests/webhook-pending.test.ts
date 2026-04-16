import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createTestDb } from "../src/db/database.js";
import { StubTelegramService } from "../src/services/telegram.js";
import { buildPayload, makeHeaders, TEST_SECRET } from "./helpers.js";
import type Database from "better-sqlite3";

describe("Pending Order Lifecycle", () => {
  let app: ReturnType<typeof createApp>;
  let db: Database.Database;
  let telegram: StubTelegramService;

  beforeEach(() => {
    db = createTestDb();
    telegram = new StubTelegramService();
    app = createApp({ db, webhookSecret: TEST_SECRET, telegram, followTradingEnabled: false, followLotSize: 0.01 });
  });

  // Test 6: Create buy limit / sell limit / buy stop / sell stop
  it("should accept PENDING_ORDER_CREATED", async () => {
    const payload = buildPayload({
      event_type: "PENDING_ORDER_CREATED",
      direction: "BUY",
      price: 3200.0,
      volume: 0.1,
      position_id: null,
      deal_ticket: null,
      idempotency_key: "12345678|ord-001|PENDING_ORDER_CREATED|1713100000000",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(telegram.sentMessages[0]).toContain("PENDING ORDER CREATED");
  });

  // Test 7: Modify pending order price
  it("should accept PENDING_ORDER_UPDATED for price change", async () => {
    const payload = buildPayload({
      event_type: "PENDING_ORDER_UPDATED",
      direction: "BUY",
      price: 3190.0,
      volume: 0.1,
      position_id: null,
      deal_ticket: null,
      idempotency_key: "12345678|ord-001|PENDING_ORDER_UPDATED|1713100001000",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentMessages[0]).toContain("PENDING ORDER UPDATED");
  });

  // Test 8: Modify pending order SL/TP
  it("should accept PENDING_ORDER_UPDATED for SL/TP change", async () => {
    const payload = buildPayload({
      event_type: "PENDING_ORDER_UPDATED",
      direction: "SELL",
      price: 3300.0,
      sl: 3310.0,
      tp: 3280.0,
      position_id: null,
      deal_ticket: null,
      idempotency_key: "12345678|ord-002|PENDING_ORDER_UPDATED|1713100002000",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentMessages[0]).toContain("3310");
  });

  // Test 9: Cancel pending order
  it("should accept PENDING_ORDER_CANCELLED", async () => {
    const payload = buildPayload({
      event_type: "PENDING_ORDER_CANCELLED",
      direction: "BUY",
      price: 3200.0,
      volume: 0.1,
      position_id: null,
      deal_ticket: null,
      idempotency_key: "12345678|ord-001|PENDING_ORDER_CANCELLED|1713100003000",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentMessages[0]).toContain("PENDING ORDER CANCELLED");
  });

  // Test 10: Pending order fills into live position
  it("should accept PENDING_ORDER_FILLED", async () => {
    const payload = buildPayload({
      event_type: "PENDING_ORDER_FILLED",
      direction: "BUY",
      price: 3200.0,
      volume: 0.1,
      position_id: "530218320",
      deal_ticket: null,
      idempotency_key: "12345678|ord-001|PENDING_ORDER_FILLED|1713100004000",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentMessages[0]).toContain("PENDING ORDER FILLED");
  });
});
