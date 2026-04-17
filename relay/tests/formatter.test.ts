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
    expect(msg).toContain("\u9EC4\u91D1");
    expect(msg).toContain("\u505A\u591A BUY NOW");
    expect(msg).toContain("\u5165\u573A Entry\uFF1A<b>3234.56</b>");
    expect(msg).toContain("\u9632\u5B88 SL\uFF1A<b>3228.00</b>");
    expect(msg).toContain("\u76EE\u6807 TP\uFF1A<b>3248.00</b>");
    expect(msg).toContain("\u624B\u6570 Volume: 0.10");
    expect(msg).toContain("\u5355\u53F7 Position: 530218319");
    expect(msg).toContain("Educational purpose only. Trade at your own risk.");
    expect(msg).not.toContain("Market Order");
    expect(msg).not.toContain("LONG ORDER");
    expect(msg).not.toContain("Nexus Group");
  });

  it("should format POSITION_OPENED SELL with SELL NOW direction", () => {
    const payload = buildPayload({
      event_type: "POSITION_OPENED",
      symbol: "EURUSD",
      direction: "SELL",
      volume: 0.5,
      price: 1.0845,
    });

    const msg = formatTelegramMessage(payload);

    expect(msg).toContain("\u505A\u7A7A SELL NOW");
    expect(msg).not.toContain("SHORT TRADE");
    expect(msg).not.toContain("SHORT ORDER");
  });

  it("should format STOP_LOSS_TRIGGERED with reason SL", () => {
    const payload = buildPayload({
      event_type: "STOP_LOSS_TRIGGERED",
      price: 3228.0,
    });

    const msg = formatTelegramMessage(payload);

    expect(msg).toContain("SL Triggered");
    expect(msg).toContain("止損 SL");
  });

  it("should format TAKE_PROFIT_TRIGGERED with reason TP", () => {
    const payload = buildPayload({
      event_type: "TAKE_PROFIT_TRIGGERED",
      price: 3248.0,
    });

    const msg = formatTelegramMessage(payload);

    expect(msg).toContain("TP Triggered");
    expect(msg).toContain("止盈 TP");
  });

  it("should format SL_UPDATED with SL and TP values", () => {
    const payload = buildPayload({
      event_type: "SL_UPDATED",
      sl: 3225.0,
      tp: 3255.0,
    });

    const msg = formatTelegramMessage(payload);

    expect(msg).toContain("Stop Loss Edited");
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

    expect(msg).toContain("BUY LIMIT");
    expect(msg).toContain("\u9650\u4EF7\u505A\u591A");
    expect(msg).toContain("88112233");
    expect(msg).not.toContain("Limit Order");
    expect(msg).not.toContain("LONG ORDER");
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
    const slLine = lines.find((l) => l.includes("\u9632\u5B88 SL"));
    const tpLine = lines.find((l) => l.includes("\u76EE\u6807 TP"));
    expect(slLine).toContain("\u2014");
    expect(tpLine).toContain("\u2014");
  });

  it("should format partial close with volume", () => {
    const payload = buildPayload({
      event_type: "POSITION_PARTIALLY_CLOSED",
      volume: 0.05,
      price: 3242.0,
      reason: "MANUAL",
    });

    const msg = formatTelegramMessage(payload);

    expect(msg).toContain("Partial TP");
    expect(msg).toContain("0.05");
  });
});
