import { describe, expect, it } from "vitest";
import { buildPayload } from "./helpers.js";
import {
  classifyMarketOrder,
  deriveTrackedOrders,
  isBreakEvenFromSl,
} from "../src/domain/market-order-classifier.js";

describe("market-order add-layer classifier", () => {
  it("treats a same-symbol same-direction market order within 10 points of the recent entry as add layer", () => {
    const tracked = deriveTrackedOrders([
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "pos-1",
        order_ticket: "ord-1",
        symbol: "XAUUSD",
        direction: "BUY",
        price: 3234.5,
        sl: 3233.8,
      }),
    ]);

    const result = classifyMarketOrder(
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "pos-2",
        order_ticket: "ord-2",
        symbol: "XAUUSD",
        direction: "BUY",
        price: 3234.7,
        sl: 3234.0,
      }),
      tracked,
    );

    expect(result.kind).toBe("add_layer");
    expect(result.matchedPositionId).toBe("pos-1");
  });

  it("treats the 10-point entry boundary as add layer", () => {
    const tracked = deriveTrackedOrders([
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "pos-1",
        symbol: "XAUUSD",
        direction: "BUY",
        price: 3244.5,
        sl: 3234.5,
      }),
    ]);

    const result = classifyMarketOrder(
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "pos-2",
        symbol: "XAUUSD",
        direction: "BUY",
        price: 3244.5,
      }),
      tracked,
    );

    expect(result.kind).toBe("add_layer");
  });

  it("treats raw entry-price distance above 10.0 as a new order", () => {
    const tracked = deriveTrackedOrders([
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "pos-1",
        symbol: "XAUUSD",
        direction: "BUY",
        price: 3234.5,
        sl: 3244.51,
      }),
    ]);

    const result = classifyMarketOrder(
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "pos-2",
        symbol: "XAUUSD",
        direction: "BUY",
        price: 3234.5,
      }),
      tracked,
    );

    expect(result.kind).toBe("new_order");
  });

  it("does not classify as add layer when the candidate order is already BE=true", () => {
    const tracked = deriveTrackedOrders([
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "pos-1",
        symbol: "XAUUSD",
        direction: "BUY",
        price: 3234.5,
        sl: 3233.8,
      }),
      buildPayload({
        event_type: "SL_UPDATED",
        position_id: "pos-1",
        symbol: "XAUUSD",
        direction: "BUY",
        open_price: 3234.5,
        price: 3235.0,
        sl: 3234.5,
      }),
    ]);

    const result = classifyMarketOrder(
      buildPayload({
        event_type: "POSITION_INCREASED",
        position_id: "pos-2",
        symbol: "XAUUSD",
        direction: "BUY",
        price: 3234.6,
      }),
      tracked,
    );

    expect(result.kind).toBe("new_order");
  });

  it("ignores opposite-direction or different-symbol candidates", () => {
    const tracked = deriveTrackedOrders([
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "sell-pos",
        symbol: "XAUUSD",
        direction: "SELL",
        price: 3234.5,
        sl: 3235.2,
      }),
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "eur-pos",
        symbol: "EURUSD",
        direction: "BUY",
        price: 1.0845,
        sl: 1.0835,
      }),
    ]);

    const result = classifyMarketOrder(
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "buy-pos",
        symbol: "XAUUSD",
        direction: "BUY",
        price: 3234.6,
      }),
      tracked,
    );

    expect(result.kind).toBe("new_order");
  });

  it("uses the most recent qualifying non-BE entry when multiple orders exist", () => {
    const tracked = deriveTrackedOrders([
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "be-pos",
        symbol: "XAUUSD",
        direction: "BUY",
        price: 3230.0,
        sl: 3229.0,
      }),
      buildPayload({
        event_type: "SL_UPDATED",
        position_id: "be-pos",
        symbol: "XAUUSD",
        direction: "BUY",
        open_price: 3230.0,
        price: 3231.0,
        sl: 3230.0,
      }),
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "live-pos",
        symbol: "XAUUSD",
        direction: "BUY",
        price: 3234.0,
        sl: 3233.6,
      }),
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "latest-pos",
        symbol: "XAUUSD",
        direction: "BUY",
        price: 3234.2,
        sl: 3233.9,
      }),
    ]);

    const result = classifyMarketOrder(
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "new-pos",
        symbol: "XAUUSD",
        direction: "BUY",
        price: 3234.4,
      }),
      tracked,
    );

    expect(result.kind).toBe("add_layer");
    expect(result.matchedPositionId).toBe("latest-pos");
  });

  it("marks BE from SL reaching entry for BUY and SELL orders", () => {
    expect(
      isBreakEvenFromSl({ direction: "BUY", entryPrice: 3234.5, stopLoss: 3234.5 }),
    ).toBe(true);
    expect(
      isBreakEvenFromSl({ direction: "SELL", entryPrice: 3234.5, stopLoss: 3234.5 }),
    ).toBe(true);
    expect(
      isBreakEvenFromSl({ direction: "BUY", entryPrice: 3234.5, stopLoss: 3234.4 }),
    ).toBe(false);
  });

  it("drops fully closed positions from tracked candidates", () => {
    const tracked = deriveTrackedOrders([
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "pos-1",
        symbol: "XAUUSD",
        direction: "BUY",
        price: 3234.5,
        sl: 3233.8,
      }),
      buildPayload({
        event_type: "POSITION_CLOSED",
        position_id: "pos-1",
        symbol: "XAUUSD",
        direction: "BUY",
        open_price: 3234.5,
        price: 3236.0,
      }),
    ]);

    expect(tracked).toHaveLength(0);
  });

  it("falls back to price when parsed payload defaulted open_price to 0", () => {
    const tracked = deriveTrackedOrders([
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "pos-1",
        symbol: "XAUUSD",
        direction: "BUY",
        price: 3234.5,
        open_price: 0,
        sl: 3233.8,
      }),
    ]);

    const result = classifyMarketOrder(
      buildPayload({
        event_type: "POSITION_OPENED",
        position_id: "pos-2",
        symbol: "XAUUSD",
        direction: "BUY",
        price: 3240.0,
        open_price: 0,
      }),
      tracked,
    );

    expect(result.kind).toBe("add_layer");
  });
});
