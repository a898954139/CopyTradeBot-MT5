import { describe, it, expect } from "vitest";
import { calculatePips, pipDistance, formatPips } from "../src/formatters/pips.js";

describe("Pips Calculation", () => {
  describe("calculatePips", () => {
    it("should calculate 10 pips for XAUUSD 4400 → 4401 BUY", () => {
      expect(calculatePips(4400, 4401, "XAUUSD", "BUY")).toBe(10);
    });

    it("should calculate -10 pips for XAUUSD 4401 → 4400 BUY (loss)", () => {
      expect(calculatePips(4401, 4400, "XAUUSD", "BUY")).toBe(-10);
    });

    it("should calculate 5 pips for XAUUSD 4400 → 4400.5 BUY", () => {
      expect(calculatePips(4400, 4400.5, "XAUUSD", "BUY")).toBe(5);
    });

    it("should calculate 10 pips for XAUUSD SELL 4401 → 4400 (profit)", () => {
      expect(calculatePips(4401, 4400, "XAUUSD", "SELL")).toBe(10);
    });

    it("should calculate -10 pips for XAUUSD SELL 4400 → 4401 (loss)", () => {
      expect(calculatePips(4400, 4401, "XAUUSD", "SELL")).toBe(-10);
    });

    it("should calculate 30 pips for XAUUSD 3234.56 → 3237.56 BUY", () => {
      expect(calculatePips(3234.56, 3237.56, "XAUUSD", "BUY")).toBe(30);
    });

    it("should return 0 for same price", () => {
      expect(calculatePips(4400, 4400, "XAUUSD", "BUY")).toBe(0);
    });
  });

  describe("pipDistance", () => {
    it("should calculate unsigned distance", () => {
      expect(pipDistance(4400, 4401, "XAUUSD")).toBe(10);
    });

    it("should return same value regardless of order", () => {
      expect(pipDistance(4401, 4400, "XAUUSD")).toBe(10);
    });

    it("should handle fractional pips", () => {
      expect(pipDistance(4400, 4400.5, "XAUUSD")).toBe(5);
    });
  });

  describe("formatPips", () => {
    it("should format positive pips with + sign", () => {
      expect(formatPips(30)).toBe("+30.0");
    });

    it("should format negative pips with - sign", () => {
      expect(formatPips(-15.5)).toBe("-15.5");
    });

    it("should format zero as +0.0", () => {
      expect(formatPips(0)).toBe("+0.0");
    });
  });
});
