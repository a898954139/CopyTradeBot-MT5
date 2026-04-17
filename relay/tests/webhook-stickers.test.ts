import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createTestDb } from "../src/db/database.js";
import { StubTelegramService } from "../src/services/telegram.js";
import { buildPayload, makeHeaders, TEST_SECRET } from "./helpers.js";
import type Database from "better-sqlite3";

describe("Sticker Notifications", () => {
  let app: ReturnType<typeof createApp>;
  let db: Database.Database;
  let telegram: StubTelegramService;

  beforeEach(() => {
    db = createTestDb();
    telegram = new StubTelegramService();
    app = createApp({ db, webhookSecret: TEST_SECRET, telegram });
  });

  it("should send text then BUY sticker photo on POSITION_OPENED BUY", async () => {
    const payload = buildPayload({
      event_type: "POSITION_OPENED",
      direction: "BUY",
      symbol: "XAUUSD",
      idempotency_key: "12345678|sticker-buy-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentPhotos).toHaveLength(1);
    expect(telegram.sentPhotos[0]).toContain("buy.png");
    expect(telegram.sentMessages).toHaveLength(1);
    expect(telegram.sentPhotoReplyTo[0]).toBe("1");
  });

  it("should send SELL sticker photo on POSITION_OPENED SELL", async () => {
    const payload = buildPayload({
      event_type: "POSITION_OPENED",
      direction: "SELL",
      symbol: "XAUUSD",
      idempotency_key: "12345678|sticker-sell-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentPhotos).toHaveLength(1);
    expect(telegram.sentPhotos[0]).toContain("sell.png");
  });

  it("should send add-layer-green sticker on POSITION_INCREASED BUY when history qualifies it as add layer", async () => {
    const firstPayload = buildPayload({
      event_type: "POSITION_OPENED",
      position_id: "hist-pos-1",
      order_ticket: "hist-ord-1",
      direction: "BUY",
      symbol: "XAUUSD",
      price: 3234.5,
      sl: 3233.8,
      idempotency_key: "12345678|seed-open-layer-001",
    });
    const firstBody = JSON.stringify(firstPayload);

    await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(firstBody))
      .send(firstBody);

    const payload = buildPayload({
      event_type: "POSITION_INCREASED",
      position_id: "hist-pos-2",
      order_ticket: "hist-ord-2",
      direction: "BUY",
      symbol: "XAUUSD",
      price: 3240.0,
      sl: 3234.0,
      idempotency_key: "12345678|sticker-layer-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentPhotos).toHaveLength(2);
    expect(telegram.sentPhotos[1]).toContain("add-layer-green.png");
    expect(telegram.sentMessages[1]).toContain("Add Position");
    expect(telegram.sentPhotoReplyTo[1]).toBe("3");
  });


  it("should send add-layer sticker for POSITION_OPENED when prior same-symbol same-direction order is within 10 points and not BE", async () => {
    const firstPayload = buildPayload({
      event_type: "POSITION_OPENED",
      position_id: "seed-pos-1",
      order_ticket: "seed-ord-1",
      direction: "BUY",
      symbol: "XAUUSD",
      price: 3234.5,
      sl: 3233.8,
      idempotency_key: "12345678|seed-open-001",
    });
    const firstBody = JSON.stringify(firstPayload);

    await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(firstBody))
      .send(firstBody);

    const payload = buildPayload({
      event_type: "POSITION_OPENED",
      position_id: "seed-pos-2",
      order_ticket: "seed-ord-2",
      direction: "BUY",
      symbol: "XAUUSD",
      price: 3240.0,
      sl: 3234.0,
      idempotency_key: "12345678|sticker-open-add-layer-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentPhotos).toHaveLength(2);
    expect(telegram.sentPhotos[1]).toContain("add-layer-green.png");
    expect(telegram.sentMessages[1]).toContain("Add Position");
  });

  it("should treat POSITION_INCREASED as a new market order when prior order is already BE", async () => {
    const firstPayload = buildPayload({
      event_type: "POSITION_OPENED",
      position_id: "be-pos-1",
      order_ticket: "be-ord-1",
      direction: "BUY",
      symbol: "XAUUSD",
      price: 3234.5,
      sl: 3233.8,
      idempotency_key: "12345678|seed-open-be-001",
    });
    const firstBody = JSON.stringify(firstPayload);

    await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(firstBody))
      .send(firstBody);

    const bePayload = buildPayload({
      event_type: "SL_UPDATED",
      position_id: "be-pos-1",
      order_ticket: "be-ord-1",
      direction: "BUY",
      symbol: "XAUUSD",
      open_price: 3234.5,
      price: 3235.0,
      sl: 3234.5,
      idempotency_key: "12345678|seed-sl-be-001",
    });
    const beBody = JSON.stringify(bePayload);

    await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(beBody))
      .send(beBody);

    const payload = buildPayload({
      event_type: "POSITION_INCREASED",
      position_id: "be-pos-2",
      order_ticket: "be-ord-2",
      direction: "BUY",
      symbol: "XAUUSD",
      price: 3234.6,
      sl: 3234.0,
      idempotency_key: "12345678|sticker-increase-new-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentPhotos).toHaveLength(3);
    expect(telegram.sentPhotos[2]).toContain("buy.png");
    expect(telegram.sentMessages[2]).toContain("Market Order");
  });

  it("should send move-sl-to-be sticker on SL_UPDATED at breakeven", async () => {
    const payload = buildPayload({
      event_type: "SL_UPDATED",
      direction: "BUY",
      open_price: 4400,
      sl: 4400.5,
      symbol: "XAUUSD",
      idempotency_key: "12345678|sticker-be-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentPhotos).toHaveLength(1);
    expect(telegram.sentPhotos[0]).toContain("move-sl-to-be.png");
  });

  it("should not send sticker for pending orders", async () => {
    const payload = buildPayload({
      event_type: "PENDING_ORDER_CREATED",
      direction: "BUY",
      position_id: null,
      deal_ticket: null,
      idempotency_key: "12345678|sticker-pending-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentPhotos).toHaveLength(0);
    expect(telegram.sentMessages).toHaveLength(1);
  });

  it("should still return success when sticker photo fails", async () => {
    // Override sendPhoto to throw
    telegram.sendPhoto = async () => {
      throw new Error("Photo upload failed");
    };

    const payload = buildPayload({
      event_type: "POSITION_OPENED",
      direction: "BUY",
      symbol: "XAUUSD",
      idempotency_key: "12345678|sticker-fail-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Text message should still have been sent
    expect(telegram.sentMessages).toHaveLength(1);
    expect(telegram.sentMessages[0]).toContain("Market Order");
  });

  it("should send sl-hit sticker on STOP_LOSS_TRIGGERED", async () => {
    const payload = buildPayload({
      event_type: "STOP_LOSS_TRIGGERED",
      direction: "BUY",
      open_price: 3234.56,
      price: 3228.0,
      sl: 3228.0,
      idempotency_key: "12345678|sticker-sl-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentPhotos).toHaveLength(1);
    expect(telegram.sentPhotos[0]).toContain("sl-hit.png");
  });

  it("should send BE Out sticker on STOP_LOSS_TRIGGERED above entry", async () => {
    const payload = buildPayload({
      event_type: "STOP_LOSS_TRIGGERED",
      direction: "BUY",
      open_price: 3234.56,
      price: 3235.06,
      sl: 3235.06,
      idempotency_key: "12345678|sticker-sl-be-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentPhotos).toHaveLength(1);
    expect(telegram.sentPhotos[0]).toContain("be-out.png");
  });

  it("should send TP sticker on partial close at +30 pips", async () => {
    const payload = buildPayload({
      event_type: "POSITION_PARTIALLY_CLOSED",
      direction: "BUY",
      open_price: 4400,
      price: 4403, // +30 pips
      symbol: "XAUUSD",
      volume: 0.05,
      idempotency_key: "12345678|sticker-tp1-001",
    });
    const body = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(telegram.sentPhotos).toHaveLength(1);
    expect(telegram.sentPhotos[0]).toContain("tp1.png");
  });
});
