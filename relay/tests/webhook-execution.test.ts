import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createTestDb } from "../src/db/database.js";
import { StubTelegramService } from "../src/services/telegram.js";
import { buildPayload, makeHeaders, TEST_SECRET } from "./helpers.js";
import type Database from "better-sqlite3";

describe("Core Execution Events", () => {
  let app: ReturnType<typeof createApp>;
  let db: Database.Database;
  let telegram: StubTelegramService;

  beforeEach(() => {
    db = createTestDb();
    telegram = new StubTelegramService();
    app = createApp({ db, webhookSecret: TEST_SECRET, telegram });
  });

  // Test 1: Market BUY opens new position
  it("should accept POSITION_OPENED for market BUY", async () => {
    const payload = buildPayload({
      event_type: "POSITION_OPENED",
      direction: "BUY",
      symbol: "XAUUSD",
      volume: 0.1,
      price: 3234.56,
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.accepted).toBe(true);
    expect(res.body.duplicate).toBe(false);
    expect(res.body.message_id).toBeDefined();
    expect(telegram.sentMessages).toHaveLength(1);
    expect(telegram.sentMessages[0]).toContain("XAUUSD");
    expect(telegram.sentMessages[0]).toContain("BUY NOW");
  });

  // Test 2: Market SELL opens new position
  it("should accept POSITION_OPENED for market SELL", async () => {
    const payload = buildPayload({
      event_type: "POSITION_OPENED",
      direction: "SELL",
      symbol: "EURUSD",
      volume: 0.5,
      price: 1.0845,
      idempotency_key: "12345678|sell-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(telegram.sentMessages[0]).toContain("SELL");
  });

  // Test 3: Add volume to existing position
  it("should accept POSITION_INCREASED", async () => {
    const payload = buildPayload({
      event_type: "POSITION_INCREASED",
      direction: "BUY",
      volume: 0.05,
      price: 3240.0,
      idempotency_key: "12345678|increase-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(telegram.sentMessages[0]).toContain("BUY NOW");
  });

  // Test 4: Partial close existing position
  it("should accept POSITION_PARTIALLY_CLOSED", async () => {
    const payload = buildPayload({
      event_type: "POSITION_PARTIALLY_CLOSED",
      direction: "SELL",
      volume: 0.05,
      price: 3242.0,
      idempotency_key: "12345678|partial-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(telegram.sentMessages[0]).toContain("Partial TP");
    expect(telegram.sentMessages[0]).toContain("0.05");
  });

  // Test 5: Full close existing position
  it("should accept POSITION_CLOSED", async () => {
    const payload = buildPayload({
      event_type: "POSITION_CLOSED",
      direction: "SELL",
      volume: 0.1,
      price: 3250.0,
      reason: "MANUAL",
      idempotency_key: "12345678|close-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(telegram.sentMessages[0]).toContain("Close Position");
  });
});
