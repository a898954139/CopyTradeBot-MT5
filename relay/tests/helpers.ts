import { createHmac } from "node:crypto";
import type { TradeEventPayload } from "../src/types.js";

export const TEST_SECRET = "test-webhook-secret-for-testing";

export function signPayload(body: string, secret: string = TEST_SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function makeHeaders(body: string, secret: string = TEST_SECRET) {
  return {
    "Content-Type": "application/json",
    "X-Source": "mt5-ea",
    "X-Signature": signPayload(body, secret),
  };
}

/** Build a valid TradeEventPayload with sensible defaults */
export function buildPayload(
  overrides: Partial<TradeEventPayload> = {},
): TradeEventPayload {
  return {
    source: "mt5-ea",
    account: "12345678",
    server: "TMGM-Demo",
    terminal_id: "vps-01",
    event_type: "POSITION_OPENED",
    idempotency_key: `12345678|${Date.now()}`,
    occurred_at: new Date().toISOString(),
    symbol: "XAUUSD",
    position_id: "530218319",
    order_ticket: "88112233",
    deal_ticket: "99887766",
    direction: "BUY",
    volume: 0.1,
    price: 3234.56,
    sl: 3228.0,
    tp: 3248.0,
    reason: "MARKET_EXECUTION",
    comment: "manual trade",
    magic: 0,
    correlation_id: "530218319",
    ...overrides,
  };
}
