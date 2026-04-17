import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createTestDb } from "../src/db/database.js";
import { StubTelegramService } from "../src/services/telegram.js";
import { buildPayload, makeHeaders, TEST_SECRET } from "./helpers.js";
import type Database from "better-sqlite3";

describe("Exit Reasons", () => {
  let app: ReturnType<typeof createApp>;
  let db: Database.Database;
  let telegram: StubTelegramService;

  beforeEach(() => {
    db = createTestDb();
    telegram = new StubTelegramService();
    app = createApp({ db, webhookSecret: TEST_SECRET, telegram });
  });

  // Test 16: Position closes by manual action
  it("should format POSITION_CLOSED with manual reason", async () => {
    const payload = buildPayload({
      event_type: "POSITION_CLOSED",
      reason: "MANUAL",
      direction: "SELL",
      volume: 0.1,
      price: 3250.0,
      idempotency_key: "12345678|close-manual",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentMessages[0]).toContain("Close Position");
  });

  // Test 17: Position closes by stop loss
  it("should format STOP_LOSS_TRIGGERED correctly", async () => {
    const payload = buildPayload({
      event_type: "STOP_LOSS_TRIGGERED",
      direction: "BUY",
      volume: 0.1,
      price: 3228.0,
      reason: "SL",
      idempotency_key: "12345678|sl-trigger-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentMessages[0]).toContain("SL Triggered");
    expect(telegram.sentMessages[0]).toContain("止損 SL");
  });

  // Test 18: Position closes by take profit
  it("should format TAKE_PROFIT_TRIGGERED correctly", async () => {
    const payload = buildPayload({
      event_type: "TAKE_PROFIT_TRIGGERED",
      direction: "BUY",
      volume: 0.1,
      price: 3248.0,
      reason: "TP",
      idempotency_key: "12345678|tp-trigger-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentMessages[0]).toContain("TP Triggered");
    expect(telegram.sentMessages[0]).toContain("止盈 TP");
  });

  // Test 19: Position closes by other/system reason
  it("should format POSITION_CLOSED with system reason", async () => {
    const payload = buildPayload({
      event_type: "POSITION_CLOSED",
      reason: "SYSTEM",
      direction: "SELL",
      volume: 0.2,
      price: 3260.0,
      idempotency_key: "12345678|close-system",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentMessages[0]).toContain("Close Position");
  });
});
