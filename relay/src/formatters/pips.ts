// ── Pip definitions per instrument ───────────────────────────────
// 1 pip = how much price movement
const PIP_SIZE: Record<string, number> = {
  XAUUSD: 0.1,
};

const DEFAULT_PIP_SIZE = 0.1;

/**
 * Calculate the pip distance between open and close price.
 * Returns signed value: positive = profit, negative = loss.
 *
 * For BUY:  pips = (close - open) / pipSize
 * For SELL: pips = (open - close) / pipSize
 */
export function calculatePips(
  openPrice: number,
  closePrice: number,
  symbol: string,
  direction: "BUY" | "SELL",
): number {
  const pipSize = PIP_SIZE[symbol] ?? DEFAULT_PIP_SIZE;
  const rawPips =
    direction === "BUY"
      ? (closePrice - openPrice) / pipSize
      : (openPrice - closePrice) / pipSize;
  return Math.round(rawPips * 10) / 10;
}

/**
 * Calculate unsigned pip distance between two prices.
 */
export function pipDistance(
  price1: number,
  price2: number,
  symbol: string,
): number {
  const pipSize = PIP_SIZE[symbol] ?? DEFAULT_PIP_SIZE;
  return Math.round((Math.abs(price1 - price2) / pipSize) * 10) / 10;
}

/**
 * Format pips for display: "+30.0" or "-15.5"
 */
export function formatPips(pips: number): string {
  const sign = pips >= 0 ? "+" : "";
  return `${sign}${pips.toFixed(1)}`;
}
