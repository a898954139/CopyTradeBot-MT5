import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createTestDb } from "../src/db/database.js";
import { StubTelegramService } from "../src/services/telegram.js";
import { buildPayload, makeHeaders, TEST_SECRET } from "./helpers.js";
import type Database from "better-sqlite3";

describe("Protection Changes (SL/TP)", () => {
  let app: ReturnType<typeof createApp>;
  let db: Database.Database;
  let telegram: StubTelegramService;

  beforeEach(() => {
    db = createTestDb();
    telegram = new StubTelegramService();
    app = createApp({ db, webhookSecret: TEST_SECRET, telegram, followTradingEnabled: false, followLotSize: 0.01 });
  });

  // Test 11: Add SL to existing position
  it("should accept SL_UPDATED when adding SL", async () => {
    const payload = buildPayload({
      event_type: "SL_UPDATED",
      sl: 3220.0,
      tp: 0,
      deal_ticket: null,
      idempotency_key: "12345678|530218319|SL_UPDATED|3220.00000|0.00000|1713100005000",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentMessages[0]).toContain("SL");
    expect(telegram.sentMessages[0]).toContain("3220");
  });

  // Test 12: Add TP to existing position
  it("should accept TP_UPDATED when adding TP", async () => {
    const payload = buildPayload({
      event_type: "TP_UPDATED",
      sl: 0,
      tp: 3260.0,
      deal_ticket: null,
      idempotency_key: "12345678|530218319|TP_UPDATED|0.00000|3260.00000|1713100006000",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentMessages[0]).toContain("TP");
    expect(telegram.sentMessages[0]).toContain("3260");
  });

  // Test 13: Modify SL only
  it("should accept SL_UPDATED when modifying SL", async () => {
    const payload = buildPayload({
      event_type: "SL_UPDATED",
      sl: 3225.0,
      tp: 3248.0,
      deal_ticket: null,
      idempotency_key: "12345678|530218319|SL_UPDATED|3225.00000|3248.00000|1713100007000",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentMessages[0]).toContain("3225");
  });

  // Test 14: Modify TP only
  it("should accept TP_UPDATED when modifying TP", async () => {
    const payload = buildPayload({
      event_type: "TP_UPDATED",
      sl: 3228.0,
      tp: 3255.0,
      deal_ticket: null,
      idempotency_key: "12345678|530218319|TP_UPDATED|3228.00000|3255.00000|1713100008000",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentMessages[0]).toContain("3255");
  });

  // Test 15: Modify both SL and TP
  it("should accept SL_UPDATED when both SL and TP change", async () => {
    const payload = buildPayload({
      event_type: "SL_UPDATED",
      sl: 3230.0,
      tp: 3260.0,
      deal_ticket: null,
      idempotency_key: "12345678|530218319|SL_UPDATED|3230.00000|3260.00000|1713100009000",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentMessages[0]).toContain("3230");
    expect(telegram.sentMessages[0]).toContain("3260");
  });
});
