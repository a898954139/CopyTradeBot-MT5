import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createTestDb } from "../src/db/database.js";
import { StubTelegramService } from "../src/services/telegram.js";
import { buildPayload, makeHeaders, signPayload, TEST_SECRET } from "./helpers.js";
import type Database from "better-sqlite3";

describe("Resilience", () => {
  let app: ReturnType<typeof createApp>;
  let db: Database.Database;
  let telegram: StubTelegramService;

  beforeEach(() => {
    db = createTestDb();
    telegram = new StubTelegramService();
    app = createApp({ db, webhookSecret: TEST_SECRET, telegram, followTradingEnabled: false, followLotSize: 0.01 });
  });

  // Test 20: Relay timeout / failure causes appropriate response
  // (We test Telegram failure → 502 response so EA knows to retry)
  it("should return 502 when Telegram send fails", async () => {
    // Override sendMessage to throw
    telegram.sendMessage = async () => {
      throw new Error("Telegram API timeout");
    };

    const payload = buildPayload({
      idempotency_key: "12345678|timeout-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.accepted).toBe(true); // event recorded, don't re-send

    // Verify audit log recorded the failure
    const audit = db
      .prepare("SELECT * FROM audit_log WHERE action = 'telegram_failed'")
      .all();
    expect(audit).toHaveLength(1);
  });

  // Test 21: Replay succeeds (second attempt after initial failure)
  it("should accept same event after Telegram failure on retry", async () => {
    const payload = buildPayload({
      idempotency_key: "12345678|replay-001",
    });
    const body = JSON.stringify(payload);

    // First: Telegram fails
    telegram.sendMessage = async () => {
      throw new Error("timeout");
    };

    await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    // Second: Same event, now recorded as duplicate
    telegram.sendMessage = async (text: string) => {
      telegram.sentMessages.push(text);
      return "42";
    };

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    // Should be treated as duplicate since it was already recorded
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
  });

  // Test 22: Duplicate payload sent twice only reaches Telegram once
  it("should dedup duplicate payloads — Telegram receives only once", async () => {
    const payload = buildPayload({
      idempotency_key: "12345678|dedup-001",
    });
    const body = JSON.stringify(payload);

    // First send
    const res1 = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res1.status).toBe(200);
    expect(res1.body.duplicate).toBe(false);

    // Second send — same idempotency key
    const res2 = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res2.status).toBe(200);
    expect(res2.body.duplicate).toBe(true);

    // Telegram should only have received one message
    expect(telegram.sentMessages).toHaveLength(1);
  });

  // Test 23: Invalid auth gets dropped and logged
  it("should reject requests with invalid auth", async () => {
    const payload = buildPayload({
      idempotency_key: "12345678|badauth-001",
    });
    const body = JSON.stringify(payload);

    // Send with wrong secret
    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set({
        "Content-Type": "application/json",
        "X-Source": "mt5-ea",
        "X-Signature": signPayload(body, "wrong-secret"),
      })
      .send(body);

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(telegram.sentMessages).toHaveLength(0);
  });

  // Test 24: Schema error returns 400 and EA marks non-retryable
  it("should return 400 for invalid schema", async () => {
    const badPayload = {
      source: "mt5-ea",
      // Missing required fields
      event_type: "INVALID_EVENT",
    };
    const body = JSON.stringify(badPayload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain("Schema validation failed");
    expect(telegram.sentMessages).toHaveLength(0);
  });
});
