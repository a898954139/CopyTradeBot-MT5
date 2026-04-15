import { describe, it, expect } from "vitest";
import { formatTelegramMessage } from "../src/formatters/telegram-formatter.js";
import { buildPayload } from "./helpers.js";

describe("Telegram Formatter", () => {
  it("should format POSITION_OPENED with all fields", () => {
    const payload = buildPayload({
      event_type: "POSITION_OPENED",
      symbol: "XAUUSD",
      direction: "BUY",
      volume: 0.1,
      price: 3234.56,
      sl: 3228.0,
      tp: 3248.0,
    });

    const msg = formatTelegramMessage(payload);

    expect(msg).toContain("XAUUSD");
    expect(msg).toContain("POSITION OPENED");
    expect(msg).toContain("BUY");
    expect(msg).toContain("0.10");
    expect(msg).toContain("3234.56");
    expect(msg).toContain("3228.00");
    expect(msg).toContain("3248.00");
  });

  it("should format STOP_LOSS_TRIGGERED with reason SL", () => {
    const payload = buildPayload({
      event_type: "STOP_LOSS_TRIGGERED",
      price: 3228.0,
    });

    const msg = formatTelegramMessage(payload);

    expect(msg).toContain("STOP LOSS TRIGGERED");
    expect(msg).toContain("Reason: SL");
  });

  it("should format TAKE_PROFIT_TRIGGERED with reason TP", () => {
    const payload = buildPayload({
      event_type: "TAKE_PROFIT_TRIGGERED",
      price: 3248.0,
    });

    const msg = formatTelegramMessage(payload);

    expect(msg).toContain("TAKE PROFIT TRIGGERED");
    expect(msg).toContain("Reason: TP");
  });

  it("should format SL_UPDATED with SL and TP values", () => {
    const payload = buildPayload({
      event_type: "SL_UPDATED",
      sl: 3225.0,
      tp: 3255.0,
    });

    const msg = formatTelegramMessage(payload);

    expect(msg).toContain("SL UPDATED");
    expect(msg).toContain("3225.00");
    expect(msg).toContain("3255.00");
  });

  it("should format PENDING_ORDER_CREATED with order ticket", () => {
    const payload = buildPayload({
      event_type: "PENDING_ORDER_CREATED",
      order_ticket: "88112233",
      position_id: null,
      deal_ticket: null,
    });

    const msg = formatTelegramMessage(payload);

    expect(msg).toContain("PENDING ORDER CREATED");
    expect(msg).toContain("88112233");
  });

  it("should handle zero SL/TP with dash", () => {
    const payload = buildPayload({
      event_type: "POSITION_OPENED",
      sl: 0,
      tp: 0,
    });

    const msg = formatTelegramMessage(payload);

    // Zero values should show as dash
    const lines = msg.split("\n");
    const slLine = lines.find((l) => l.startsWith("SL:"));
    const tpLine = lines.find((l) => l.startsWith("TP:"));
    expect(slLine).toContain("—");
    expect(tpLine).toContain("—");
  });

  it("should format partial close with volume and reason", () => {
    const payload = buildPayload({
      event_type: "POSITION_PARTIALLY_CLOSED",
      volume: 0.05,
      price: 3242.0,
      reason: "MANUAL",
    });

    const msg = formatTelegramMessage(payload);

    expect(msg).toContain("POSITION PARTIALLY CLOSED");
    expect(msg).toContain("0.05");
    expect(msg).toContain("MANUAL");
  });
});
