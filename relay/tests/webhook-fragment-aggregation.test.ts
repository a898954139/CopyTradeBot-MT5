import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createTestDb } from "../src/db/database.js";
import { StubTelegramService } from "../src/services/telegram.js";
import { buildPayload, makeHeaders, TEST_SECRET } from "./helpers.js";
import type Database from "better-sqlite3";

describe("Broker Fragment Aggregation", () => {
  let app: ReturnType<typeof createApp>;
  let db: Database.Database;
  let telegram: StubTelegramService;

  beforeEach(() => {
    db = createTestDb();
    telegram = new StubTelegramService();
    app = createApp({ db, webhookSecret: TEST_SECRET, telegram });
  });

  async function post(payload: ReturnType<typeof buildPayload>) {
    const body = JSON.stringify(payload);
    return request(app)
      .post("/webhooks/mt5/events")
      .set(makeHeaders(body))
      .send(body);
  }

  it("collapses a 2.00-lot TP fill split into 2x1.00 fragments into one Telegram message", async () => {
    // Fragment 1 — broker fills 1.00 of 2.00 at TP
    const frag1 = buildPayload({
      event_type: "TAKE_PROFIT_TRIGGERED",
      direction: "BUY",
      volume: 1.0,
      price: 3250.0,
      open_price: 3234.56,
      total_volume: 1.0,
      position_id: "P-2LOT",
      deal_ticket: "deal-1",
      idempotency_key: "acct|deal-1",
      reason: "TP",
    });
    const r1 = await post(frag1);
    expect(r1.status).toBe(200);
    expect(telegram.sentMessages).toHaveLength(1);

    // Fragment 2 — remaining 1.00 at TP, arrives milliseconds later
    const frag2 = buildPayload({
      event_type: "TAKE_PROFIT_TRIGGERED",
      direction: "BUY",
      volume: 1.0,
      price: 3250.0,
      open_price: 3234.56,
      total_volume: 1.0,
      position_id: "P-2LOT",
      deal_ticket: "deal-2",
      idempotency_key: "acct|deal-2",
      reason: "TP",
    });
    const r2 = await post(frag2);
    expect(r2.status).toBe(200);

    // Still only ONE sent message; the fragment should have edited it.
    expect(telegram.sentMessages).toHaveLength(1);
    expect(telegram.editedMessages).toHaveLength(1);

    // The visible content must reflect the combined 2.00 lot close.
    expect(telegram.sentMessages[0]).toContain("2.00");
    // Second response should reuse the first message_id.
    expect(r2.body.message_id).toBe(r1.body.message_id);
  });

  it("aggregates 3 fragments into a single message", async () => {
    for (let i = 1; i <= 3; i++) {
      const p = buildPayload({
        event_type: "TAKE_PROFIT_TRIGGERED",
        direction: "SELL",
        volume: 0.5,
        price: 3200.0,
        open_price: 3220.0,
        total_volume: 0.5,
        position_id: "P-FRAG3",
        deal_ticket: `d-${i}`,
        idempotency_key: `acct|d-${i}`,
        reason: "TP",
      });
      const r = await post(p);
      expect(r.status).toBe(200);
    }
    expect(telegram.sentMessages).toHaveLength(1);
    expect(telegram.editedMessages).toHaveLength(2);
    expect(telegram.sentMessages[0]).toContain("1.50");
  });

  it("does NOT aggregate close events across different positions", async () => {
    const a = buildPayload({
      event_type: "TAKE_PROFIT_TRIGGERED",
      direction: "BUY",
      volume: 1.0,
      price: 3250.0,
      position_id: "POS-A",
      deal_ticket: "da",
      idempotency_key: "acct|da",
      reason: "TP",
    });
    const b = buildPayload({
      event_type: "TAKE_PROFIT_TRIGGERED",
      direction: "BUY",
      volume: 1.0,
      price: 3250.0,
      position_id: "POS-B",
      deal_ticket: "db",
      idempotency_key: "acct|db",
      reason: "TP",
    });
    await post(a);
    await post(b);
    expect(telegram.sentMessages).toHaveLength(2);
    expect(telegram.editedMessages).toHaveLength(0);
  });

  it("does NOT aggregate open events (only close family)", async () => {
    const o1 = buildPayload({
      event_type: "POSITION_OPENED",
      direction: "BUY",
      volume: 1.0,
      price: 3234.56,
      position_id: "P-OPEN",
      deal_ticket: "o1",
      idempotency_key: "acct|o1",
    });
    const o2 = buildPayload({
      event_type: "POSITION_INCREASED",
      direction: "BUY",
      volume: 1.0,
      price: 3234.56,
      position_id: "P-OPEN",
      deal_ticket: "o2",
      idempotency_key: "acct|o2",
    });
    await post(o1);
    await post(o2);
    expect(telegram.sentMessages).toHaveLength(2);
  });

  it("sends only ONE sticker when a BE close arrives as two fragments", async () => {
    // Two fragments of the same BE close, arriving within the aggregation
    // window. Each fragment on its own resolves to be-out.png. The second
    // fragment must edit the first text message and NOT send a second sticker.
    const frag1 = buildPayload({
      event_type: "STOP_LOSS_TRIGGERED",
      direction: "BUY",
      volume: 1.0,
      price: 3235.06,
      open_price: 3234.56,
      sl: 3235.06,
      total_volume: 1.0,
      position_id: "P-BE-FRAG",
      deal_ticket: "be-1",
      idempotency_key: "acct|be-1",
      reason: "SL",
    });
    const frag2 = buildPayload({
      event_type: "POSITION_CLOSED",
      direction: "BUY",
      volume: 1.0,
      price: 3235.06,
      open_price: 3234.56,
      sl: 3235.06,
      total_volume: 1.0,
      position_id: "P-BE-FRAG",
      deal_ticket: "be-2",
      idempotency_key: "acct|be-2",
      reason: "SL",
    });

    const r1 = await post(frag1);
    expect(r1.status).toBe(200);
    const r2 = await post(frag2);
    expect(r2.status).toBe(200);

    expect(telegram.sentMessages).toHaveLength(1);
    expect(telegram.editedMessages).toHaveLength(1);
    // Critical: exactly one sticker, not two.
    expect(telegram.sentPhotos).toHaveLength(1);
    expect(telegram.sentPhotos[0]).toContain("be-out.png");
  });

  it("sends only ONE sticker across 3 partial-close fragments", async () => {
    // Three broker fragments of a profitable partial close. Each fragment
    // individually resolves to a TP-tier sticker. Only the first should
    // actually be sent; subsequent fragments just edit the text.
    for (let i = 1; i <= 3; i++) {
      const p = buildPayload({
        event_type: "POSITION_PARTIALLY_CLOSED",
        direction: "BUY",
        volume: 0.5,
        price: 3237.56, // +30 pips → tp1 tier
        open_price: 3234.56,
        total_volume: 0.5,
        position_id: "P-PARTIAL-FRAG",
        deal_ticket: `pc-${i}`,
        idempotency_key: `acct|pc-${i}`,
        reason: "MANUAL",
      });
      const r = await post(p);
      expect(r.status).toBe(200);
    }
    expect(telegram.sentMessages).toHaveLength(1);
    expect(telegram.editedMessages).toHaveLength(2);
    expect(telegram.sentPhotos).toHaveLength(1);
  });

  it("promotes a fragmented PARTIAL+CLOSE sequence into a single close message", async () => {
    const partial = buildPayload({
      event_type: "POSITION_PARTIALLY_CLOSED",
      direction: "BUY",
      volume: 1.0,
      price: 3250.0,
      open_price: 3234.56,
      total_volume: 1.0, // remaining after this fragment
      position_id: "P-PARTIAL-CLOSE",
      deal_ticket: "dp1",
      idempotency_key: "acct|dp1",
      reason: "MANUAL",
    });
    const full = buildPayload({
      event_type: "POSITION_CLOSED",
      direction: "BUY",
      volume: 1.0,
      price: 3250.0,
      open_price: 3234.56,
      total_volume: 1.0,
      position_id: "P-PARTIAL-CLOSE",
      deal_ticket: "dp2",
      idempotency_key: "acct|dp2",
      reason: "MANUAL",
    });
    await post(partial);
    await post(full);

    expect(telegram.sentMessages).toHaveLength(1);
    expect(telegram.editedMessages).toHaveLength(1);
    // Aggregated message should show 2.00 total closed volume.
    expect(telegram.sentMessages[0]).toContain("2.00");
  });
});
