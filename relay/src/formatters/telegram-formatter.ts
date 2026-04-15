import type { TradeEventPayload, BusinessEvent } from "../types.js";

// ── Event family grouping ─────────────────────────────────────────
type EventFamily =
  | "execution_open"
  | "execution_close"
  | "pending_order"
  | "sl_tp_modification"
  | "sl_tp_triggered";

const EVENT_FAMILY_MAP: Record<BusinessEvent, EventFamily> = {
  POSITION_OPENED: "execution_open",
  POSITION_INCREASED: "execution_open",
  POSITION_PARTIALLY_CLOSED: "execution_close",
  POSITION_CLOSED: "execution_close",
  SL_UPDATED: "sl_tp_modification",
  TP_UPDATED: "sl_tp_modification",
  STOP_LOSS_TRIGGERED: "sl_tp_triggered",
  TAKE_PROFIT_TRIGGERED: "sl_tp_triggered",
  PENDING_ORDER_CREATED: "pending_order",
  PENDING_ORDER_UPDATED: "pending_order",
  PENDING_ORDER_CANCELLED: "pending_order",
  PENDING_ORDER_FILLED: "pending_order",
};

const EVENT_LABEL: Record<BusinessEvent, string> = {
  POSITION_OPENED: "\u{1F7E2} \u958B\u5009 Open Position",
  POSITION_INCREASED: "\u{2795} \u52A0\u5009 Add Position",
  POSITION_PARTIALLY_CLOSED: "\u{1F7E1} \u90E8\u5206\u5E73\u5009 Partial Close",
  POSITION_CLOSED: "\u{1F534} \u5E73\u5009 Close Position",
  SL_UPDATED: "\u{1F6E1}\uFE0F \u4FEE\u6539\u6B62\u640D SL Updated",
  TP_UPDATED: "\u{1F3AF} \u4FEE\u6539\u6B62\u76C8 TP Updated",
  STOP_LOSS_TRIGGERED: "\u{1F6A8} \u6B62\u640D\u89F8\u767C SL Triggered",
  TAKE_PROFIT_TRIGGERED: "\u{1F3C6} \u6B62\u76C8\u89F8\u767C TP Triggered",
  PENDING_ORDER_CREATED: "\u{1F4CB} \u65B0\u639B\u55AE Pending Order",
  PENDING_ORDER_UPDATED: "\u{270F}\uFE0F \u4FEE\u6539\u639B\u55AE Order Updated",
  PENDING_ORDER_CANCELLED: "\u{274C} \u53D6\u6D88\u639B\u55AE Order Cancelled",
  PENDING_ORDER_FILLED: "\u{2705} \u639B\u55AE\u6210\u4EA4 Order Filled",
};

// ── Main formatter ────────────────────────────────────────────────
export function formatTelegramMessage(payload: TradeEventPayload): string {
  const family = EVENT_FAMILY_MAP[payload.event_type];
  const label = EVENT_LABEL[payload.event_type];
  const header = `${label}\n<b>[${payload.symbol}]</b>`;

  switch (family) {
    case "execution_open":
      return formatExecutionOpen(header, payload);
    case "execution_close":
      return formatExecutionClose(header, payload);
    case "pending_order":
      return formatPendingOrder(header, payload);
    case "sl_tp_modification":
      return formatSLTPModification(header, payload);
    case "sl_tp_triggered":
      return formatSLTPTriggered(header, payload);
  }
}

function dirLabel(d: string | null): string {
  if (d === "BUY") return "\u{1F535} \u505A\u591A Buy";
  if (d === "SELL") return "\u{1F534} \u505A\u7A7A Sell";
  return "\u2014";
}

function formatPrice(value: number): string {
  if (value === 0) return "\u2014";
  return value.toFixed(value >= 100 ? 2 : 5);
}

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  } catch {
    return isoString;
  }
}

// ── Family formatters ─────────────────────────────────────────────

function formatExecutionOpen(
  header: string,
  p: TradeEventPayload,
): string {
  return [
    header,
    `\u65B9\u5411 Direction: <b>${dirLabel(p.direction)}</b>`,
    `\u624B\u6578 Volume: <b>${p.volume.toFixed(2)}</b>`,
    `\u50F9\u683C Price: <b>${formatPrice(p.price)}</b>`,
    `\u6B62\u640D SL: ${formatPrice(p.sl)}`,
    `\u6B62\u76C8 TP: ${formatPrice(p.tp)}`,
    p.position_id ? `\u55AE\u865F Position: ${p.position_id}` : null,
    `\u6642\u9593 Time: ${formatTime(p.occurred_at)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatExecutionClose(
  _header: string,
  p: TradeEventPayload,
): string {
  const openPrice = p.open_price ?? 0;
  const rawTotalVol = p.total_volume ?? 0;
  // For partial close: total_volume from position is the REMAINING volume after close.
  // Actual total before close = remaining + closed volume.
  // For full close: total_volume = closed volume (position gone).
  const isPartial = p.event_type === "POSITION_PARTIALLY_CLOSED" ||
    (rawTotalVol > 0 && rawTotalVol !== p.volume);
  const totalBeforeClose = isPartial ? rawTotalVol + p.volume : rawTotalVol;
  const closePercent = totalBeforeClose > 0
    ? ((p.volume / totalBeforeClose) * 100).toFixed(0)
    : null;

  // Partial close: user never does partial close at a loss, always show Partial TP
  // Full close: judge profit/loss based on direction and prices
  let closeLabel: string;
  if (isPartial) {
    closeLabel = "\u{1F4B5} \u6536\u8D70\u90E8\u5206\u5229\u6F64 Partial TP";
  } else if (openPrice > 0 && p.price > 0 && p.direction) {
    const isProfitable =
      (p.direction === "BUY" && p.price > openPrice) ||
      (p.direction === "SELL" && p.price < openPrice);
    closeLabel = isProfitable
      ? "\u{1F4B0} \u6B62\u76C8\u51FA\u5834 Take Profit"
      : "\u{1F4C9} \u6B62\u640D\u51FA\u5834 Stop Loss";
  } else {
    closeLabel = "\u{1F534} \u5E73\u5009 Close Position";
  }

  return [
    `${closeLabel}\n<b>[${p.symbol}]</b>`,
    p.direction ? `\u65B9\u5411 Direction: <b>${dirLabel(p.direction)}</b>` : null,
    openPrice > 0 ? `\u958B\u5009\u50F9 Entry: ${formatPrice(openPrice)}` : null,
    `\u5E73\u5009\u50F9 Close: <b>${formatPrice(p.price)}</b>`,
    `\u5E73\u5009\u624B\u6578 Closed: <b>${p.volume.toFixed(2)}</b>${closePercent ? ` (${closePercent}%)` : ""}`,
    totalBeforeClose > 0 ? `\u7E3D\u624B\u6578 Total: ${totalBeforeClose.toFixed(2)}` : null,
    p.position_id ? `\u55AE\u865F Position: ${p.position_id}` : null,
    `\u6642\u9593 Time: ${formatTime(p.occurred_at)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatPendingOrder(
  header: string,
  p: TradeEventPayload,
): string {
  return [
    header,
    `\u65B9\u5411 Direction: <b>${dirLabel(p.direction)}</b>`,
    `\u50F9\u683C Price: <b>${formatPrice(p.price)}</b>`,
    `\u624B\u6578 Volume: <b>${p.volume.toFixed(2)}</b>`,
    `\u6B62\u640D SL: ${formatPrice(p.sl)}`,
    `\u6B62\u76C8 TP: ${formatPrice(p.tp)}`,
    p.order_ticket ? `\u8A02\u55AE Order: ${p.order_ticket}` : null,
    `\u6642\u9593 Time: ${formatTime(p.occurred_at)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatSLTPModification(
  header: string,
  p: TradeEventPayload,
): string {
  // Determine if SL is a protective move (SL >= open_price for BUY, SL <= open_price for SELL)
  const entryPrice = p.open_price ?? p.price;
  let slLabel = "\u6B62\u640D SL";
  if (p.event_type === "SL_UPDATED" && p.sl > 0 && entryPrice > 0 && p.direction) {
    // Strict comparison: SL >= open_price (BUY) or SL <= open_price (SELL)
    const isProtective =
      (p.direction === "BUY" && p.sl >= entryPrice) ||
      (p.direction === "SELL" && p.sl <= entryPrice);
    slLabel = isProtective
      ? "\u{1F199} \u4FDD\u8B77\u63A8\u4E0A Breakeven+"
      : "\u{1F6E1}\uFE0F \u4FEE\u6539\u6B62\u640D SL";
  }

  return [
    p.event_type === "SL_UPDATED"
      ? `${slLabel}\n<b>[${p.symbol}]</b>`
      : header,
    p.direction ? `\u65B9\u5411 Direction: <b>${dirLabel(p.direction)}</b>` : null,
    entryPrice > 0 ? `\u958B\u5009\u50F9 Entry: ${formatPrice(entryPrice)}` : null,
    `\u6B62\u640D SL: <b>${formatPrice(p.sl)}</b>`,
    `\u6B62\u76C8 TP: <b>${formatPrice(p.tp)}</b>`,
    p.position_id ? `\u55AE\u865F Position: ${p.position_id}` : null,
    `\u6642\u9593 Time: ${formatTime(p.occurred_at)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatSLTPTriggered(
  header: string,
  p: TradeEventPayload,
): string {
  return [
    header,
    `\u65B9\u5411 Direction: <b>${dirLabel(p.direction)}</b>`,
    `\u5E73\u5009\u50F9 Close: <b>${formatPrice(p.price)}</b>`,
    `\u624B\u6578 Volume: <b>${p.volume.toFixed(2)}</b>`,
    `\u539F\u56E0 Reason: ${p.event_type === "STOP_LOSS_TRIGGERED" ? "\u6B62\u640D SL" : "\u6B62\u76C8 TP"}`,
    p.position_id ? `\u55AE\u865F Position: ${p.position_id}` : null,
    `\u6642\u9593 Time: ${formatTime(p.occurred_at)}`,
  ]
    .filter(Boolean)
    .join("\n");
}
