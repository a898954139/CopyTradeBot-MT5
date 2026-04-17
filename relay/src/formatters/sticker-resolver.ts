import { resolve } from "node:path";
import type { TradeEventPayload } from "../types.js";
import { calculatePips, pipDistance } from "./pips.js";
import {
  isBreakEvenFromSl,
  type MarketOrderClassification,
} from "../domain/market-order-classifier.js";

// Works in both CJS (__dirname) and compiled output (dist/formatters/)
const STICKERS_DIR = resolve(__dirname, "../../assets/stickers");

// ── TP level thresholds (pips) ───────────────────────────────────
const TP_LEVELS = [
  { minPips: 25, maxPips: 40, file: "tp1.png" },   // ~30 pips
  { minPips: 40, maxPips: 75, file: "tp2.png" },   // ~50 pips
  { minPips: 75, maxPips: 125, file: "tp3.png" },  // ~100 pips
  { minPips: 125, maxPips: 175, file: "tp4.png" }, // ~150 pips
  { minPips: 175, maxPips: Infinity, file: "tp5.png" }, // ~200+ pips
] as const;

// BE tolerance: within 5 pips of entry = breakeven out
const BE_TOLERANCE_PIPS = 5;

export interface StickerResult {
  readonly filePath: string;
  readonly name: string;
}

/**
 * Resolve which sticker to send for a given trade event.
 * Returns null if no sticker applies.
 */
export function resolveSticker(
  payload: TradeEventPayload,
  classification?: MarketOrderClassification,
): StickerResult | null {
  switch (payload.event_type) {
    case "POSITION_OPENED":
    case "POSITION_INCREASED":
      return resolveOpenSticker(payload, classification);

    case "POSITION_PARTIALLY_CLOSED":
      return resolvePartialCloseSticker(payload);

    case "POSITION_CLOSED":
      return resolveFullCloseSticker(payload);

    case "SL_UPDATED":
    case "SL_AND_TP_UPDATED":
      return resolveSlUpdateSticker(payload);

    case "STOP_LOSS_TRIGGERED":
      return resolveStopLossTriggeredSticker(payload);

    default:
      return null;
  }
}

function resolveOpenSticker(
  p: TradeEventPayload,
  classification?: MarketOrderClassification,
): StickerResult | null {
  if (classification?.kind === "add_layer") {
    return p.direction === "BUY"
      ? sticker("add-layer-green.png", "Add Layer Green")
      : sticker("add-layer-red.png", "Add Layer Red");
  }
  return p.direction === "BUY"
    ? sticker("buy.png", "BUY")
    : sticker("sell.png", "SELL");
}

function resolvePartialCloseSticker(p: TradeEventPayload): StickerResult | null {
  const openPrice = p.open_price ?? 0;
  if (openPrice <= 0 || p.price <= 0 || !p.direction) return null;

  const pips = Math.abs(
    calculatePips(openPrice, p.price, p.symbol, p.direction),
  );

  for (const level of TP_LEVELS) {
    if (pips >= level.minPips && pips < level.maxPips) {
      return sticker(level.file, level.file.replace(".png", "").toUpperCase());
    }
  }
  return null;
}

function resolveFullCloseSticker(p: TradeEventPayload): StickerResult | null {
  const openPrice = p.open_price ?? 0;
  if (openPrice <= 0 || p.price <= 0 || !p.direction) return null;

  const pips = calculatePips(openPrice, p.price, p.symbol, p.direction);
  const closeNearStopLoss =
    p.sl > 0 && pipDistance(p.price, p.sl, p.symbol) <= BE_TOLERANCE_PIPS;

  if (closeNearStopLoss) {
    return isBreakEvenFromSl({
      direction: p.direction,
      entryPrice: openPrice,
      stopLoss: p.sl,
    })
      ? sticker("be-out.png", "BE Out")
      : sticker("sl-hit.png", "SL Hit");
  }

  // BE Out: manual/full close within ~5 pips of entry
  if (Math.abs(pips) <= BE_TOLERANCE_PIPS) {
    return sticker("be-out.png", "BE Out");
  }

  // Profitable full close = Full TP
  if (pips > BE_TOLERANCE_PIPS) {
    return sticker("full-tp.png", "Full TP");
  }

  // Loss full close = SL Hit
  return sticker("sl-hit.png", "SL Hit");
}

function resolveSlUpdateSticker(p: TradeEventPayload): StickerResult | null {
  const entryPrice = p.open_price ?? p.price;
  if (p.sl <= 0 || entryPrice <= 0 || !p.direction) return null;

  const isBreakEven = isBreakEvenFromSl({
    direction: p.direction,
    entryPrice,
    stopLoss: p.sl,
  });

  if (isBreakEven) {
    return sticker("move-sl-to-be.png", "Move SL to BE");
  }
  return null;
}

function resolveStopLossTriggeredSticker(
  p: TradeEventPayload,
): StickerResult | null {
  const entryPrice = p.open_price ?? 0;
  if (entryPrice > 0 && p.sl > 0 && p.direction) {
    return isBreakEvenFromSl({
      direction: p.direction,
      entryPrice,
      stopLoss: p.sl,
    })
      ? sticker("be-out.png", "BE Out")
      : sticker("sl-hit.png", "SL Hit");
  }
  return sticker("sl-hit.png", "SL Hit");
}

function sticker(filename: string, name: string): StickerResult {
  return {
    filePath: resolve(STICKERS_DIR, filename),
    name,
  };
}
