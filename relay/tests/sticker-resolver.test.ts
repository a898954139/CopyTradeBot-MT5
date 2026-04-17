import { describe, it, expect } from "vitest";
import { resolveSticker } from "../src/formatters/sticker-resolver.js";
import { buildPayload } from "./helpers.js";

describe("Sticker Resolver", () => {
  describe("Open positions", () => {
    it("should resolve BUY sticker for POSITION_OPENED BUY", () => {
      const result = resolveSticker(
        buildPayload({ event_type: "POSITION_OPENED", direction: "BUY" }),
      );
      expect(result).not.toBeNull();
      expect(result!.name).toBe("BUY");
      expect(result!.filePath).toContain("buy.png");
    });

    it("should resolve SELL sticker for POSITION_OPENED SELL", () => {
      const result = resolveSticker(
        buildPayload({ event_type: "POSITION_OPENED", direction: "SELL" }),
      );
      expect(result).not.toBeNull();
      expect(result!.name).toBe("SELL");
      expect(result!.filePath).toContain("sell.png");
    });
  });

  describe("Add layer (POSITION_INCREASED)", () => {
    it("should resolve green layer for BUY increase", () => {
      const result = resolveSticker(
        buildPayload({ event_type: "POSITION_INCREASED", direction: "BUY" }),
      );
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Add Layer Green");
      expect(result!.filePath).toContain("add-layer-green.png");
    });

    it("should resolve red layer for SELL increase", () => {
      const result = resolveSticker(
        buildPayload({ event_type: "POSITION_INCREASED", direction: "SELL" }),
      );
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Add Layer Red");
      expect(result!.filePath).toContain("add-layer-red.png");
    });
  });

  describe("Partial close (TP levels)", () => {
    it("should resolve TP1 for +30 pips BUY", () => {
      const result = resolveSticker(
        buildPayload({
          event_type: "POSITION_PARTIALLY_CLOSED",
          direction: "BUY",
          open_price: 4400,
          price: 4403, // +30 pips
          symbol: "XAUUSD",
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.filePath).toContain("tp1.png");
    });

    it("should resolve TP2 for +50 pips SELL", () => {
      const result = resolveSticker(
        buildPayload({
          event_type: "POSITION_PARTIALLY_CLOSED",
          direction: "SELL",
          open_price: 4405,
          price: 4400, // +50 pips
          symbol: "XAUUSD",
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.filePath).toContain("tp2.png");
    });

    it("should resolve TP3 for +100 pips", () => {
      const result = resolveSticker(
        buildPayload({
          event_type: "POSITION_PARTIALLY_CLOSED",
          direction: "BUY",
          open_price: 4400,
          price: 4410, // +100 pips
          symbol: "XAUUSD",
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.filePath).toContain("tp3.png");
    });

    it("should resolve TP4 for +150 pips", () => {
      const result = resolveSticker(
        buildPayload({
          event_type: "POSITION_PARTIALLY_CLOSED",
          direction: "BUY",
          open_price: 4400,
          price: 4415, // +150 pips
          symbol: "XAUUSD",
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.filePath).toContain("tp4.png");
    });

    it("should resolve TP5 for +200 pips", () => {
      const result = resolveSticker(
        buildPayload({
          event_type: "POSITION_PARTIALLY_CLOSED",
          direction: "BUY",
          open_price: 4400,
          price: 4420, // +200 pips
          symbol: "XAUUSD",
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.filePath).toContain("tp5.png");
    });

    it("should return null for small pip movement (<25)", () => {
      const result = resolveSticker(
        buildPayload({
          event_type: "POSITION_PARTIALLY_CLOSED",
          direction: "BUY",
          open_price: 4400,
          price: 4401, // +10 pips, below threshold
          symbol: "XAUUSD",
        }),
      );
      expect(result).toBeNull();
    });
  });

  describe("Full close", () => {
    it("should resolve Full TP for profitable close", () => {
      const result = resolveSticker(
        buildPayload({
          event_type: "POSITION_CLOSED",
          direction: "BUY",
          open_price: 4400,
          price: 4420, // +200 pips profit
          symbol: "XAUUSD",
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Full TP");
      expect(result!.filePath).toContain("full-tp.png");
    });

    it("should resolve BE Out for close near entry (within 5 pips)", () => {
      const result = resolveSticker(
        buildPayload({
          event_type: "POSITION_CLOSED",
          direction: "BUY",
          open_price: 4400,
          price: 4400.5, // +5 pips = BE
          symbol: "XAUUSD",
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.name).toBe("BE Out");
      expect(result!.filePath).toContain("be-out.png");
    });

    it("should resolve SL Hit for losing close", () => {
      const result = resolveSticker(
        buildPayload({
          event_type: "POSITION_CLOSED",
          direction: "BUY",
          open_price: 4400,
          price: 4390, // -100 pips loss
          symbol: "XAUUSD",
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.name).toBe("SL Hit");
      expect(result!.filePath).toContain("sl-hit.png");
    });
  });

  describe("SL Update (Move SL to BE)", () => {
    it("should resolve Move SL to BE for BUY when SL >= entry", () => {
      const result = resolveSticker(
        buildPayload({
          event_type: "SL_UPDATED",
          direction: "BUY",
          open_price: 4400,
          sl: 4400.5, // SL above entry = BE
          symbol: "XAUUSD",
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Move SL to BE");
      expect(result!.filePath).toContain("move-sl-to-be.png");
    });

    it("should resolve Move SL to BE for SELL when SL <= entry", () => {
      const result = resolveSticker(
        buildPayload({
          event_type: "SL_UPDATED",
          direction: "SELL",
          open_price: 4400,
          sl: 4399.5, // SL below entry = BE for SELL
          symbol: "XAUUSD",
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Move SL to BE");
    });

    it("should return null for SL below entry on BUY (not BE)", () => {
      const result = resolveSticker(
        buildPayload({
          event_type: "SL_UPDATED",
          direction: "BUY",
          open_price: 4400,
          sl: 4395, // SL below entry = normal SL, not BE
          symbol: "XAUUSD",
        }),
      );
      expect(result).toBeNull();
    });
  });

  describe("SL Triggered", () => {
    it("should resolve SL Hit sticker", () => {
      const result = resolveSticker(
        buildPayload({
          event_type: "STOP_LOSS_TRIGGERED",
          direction: "BUY",
          price: 3228.0,
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.name).toBe("SL Hit");
      expect(result!.filePath).toContain("sl-hit.png");
    });
  });

  describe("No sticker events", () => {
    it("should return null for TP_UPDATED", () => {
      const result = resolveSticker(
        buildPayload({ event_type: "TP_UPDATED" }),
      );
      expect(result).toBeNull();
    });

    it("should return null for TAKE_PROFIT_TRIGGERED", () => {
      const result = resolveSticker(
        buildPayload({ event_type: "TAKE_PROFIT_TRIGGERED" }),
      );
      expect(result).toBeNull();
    });

    it("should return null for pending orders", () => {
      const result = resolveSticker(
        buildPayload({ event_type: "PENDING_ORDER_CREATED" }),
      );
      expect(result).toBeNull();
    });
  });
});
