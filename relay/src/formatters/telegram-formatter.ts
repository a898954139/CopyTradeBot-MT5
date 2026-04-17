import type { TradeEventPayload, BusinessEvent } from "../types.js";
import { calculatePips, formatPips, pipDistance } from "./pips.js";
import {
  isBreakEvenFromSl,
  type MarketOrderClassification,
} from "../domain/market-order-classifier.js";

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
  SL_AND_TP_UPDATED: "sl_tp_modification",
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
  SL_AND_TP_UPDATED: "\u{1F4DD} \u9632\u5B88\u548C\u76EE\u6807\u4FEE\u6539 SL & TP Updated",
  STOP_LOSS_TRIGGERED: "\u{1F6A8} \u6B62\u640D\u89F8\u767C SL Triggered",
  TAKE_PROFIT_TRIGGERED: "\u{1F3C6} \u6B62\u76C8\u89F8\u767C TP Triggered",
  PENDING_ORDER_CREATED: "\u{1F4CB} \u65B0\u639B\u55AE Pending Order",
  PENDING_ORDER_UPDATED: "\u{270F}\uFE0F \u4FEE\u6539\u639B\u55AE Order Updated",
  PENDING_ORDER_CANCELLED: "\u{274C} \u53D6\u6D88\u639B\u55AE Order Cancelled",
  PENDING_ORDER_FILLED: "\u{2705} \u639B\u55AE\u6210\u4EA4 Order Filled",
};

// ── Main formatter ────────────────────────────────────────────────
export function formatTelegramMessage(
  payload: TradeEventPayload,
  overallProfitable?: boolean | null,
  classification?: MarketOrderClassification,
): string {
  const family = EVENT_FAMILY_MAP[payload.event_type];
  const label = EVENT_LABEL[payload.event_type];
  const header = `${label}\n<b>[${payload.symbol}]</b>`;

  switch (family) {
    case "execution_open":
      return formatExecutionOpen(header, payload, classification);
    case "execution_close":
      return formatExecutionClose(header, payload, overallProfitable);
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

function dirLabelMarket(d: string | null): string {
  if (d === "BUY") return "\u{1F4C8} \u505A\u591A  BUY NOW / LONG ORDER \u{1F4C8}";
  if (d === "SELL") return "\u{1F4C9} \u505A\u7A7A SELL NOW / SHORT TRADE \u{1F4C9}";
  return "\u2014";
}

function dirLabelLimit(d: string | null): string {
  if (d === "BUY") return "\u{1F4C8} \u505A\u591A  BUY LIMIT / LONG ORDER \u{1F4C8}";
  if (d === "SELL") return "\u{1F4C9} \u505A\u7A7A SELL LIMIT / SHORT ORDER \u{1F4C9}";
  return "\u2014";
}

function dirLabelBranded(d: string | null): string {
  if (d === "BUY") return "\u{1F4C8} \u505A\u591A BUY / LONG \u{1F4C8}";
  if (d === "SELL") return "\u{1F4C9} \u505A\u7A7A SELL / SHORT \u{1F4C9}";
  return "\u2014";
}

// Map instrument symbols to Chinese names
const SYMBOL_CHINESE_MAP: Record<string, string> = {
  XAUUSD: "\u9EC4\u91D1",    // 黄金
  BTCUSD: "\u6BD4\u7279\u5E01", // 比特币
  EURUSD: "\u6B27\u5143\u7F8E\u5143", // 欧元美元
  US100:  "\u7EB3\u65AF\u8FBE\u514B", // 纳斯达克
  NAS100: "\u7EB3\u65AF\u8FBE\u514B", // 纳斯达克
};

function symbolLabel(symbol: string): string {
  const chinese = SYMBOL_CHINESE_MAP[symbol.toUpperCase()] ?? symbol;
  return `\u2B50 ${chinese} ${symbol} \u2B50`;
}

const DISCLAIMER =
  "⚠️ 仅供参考，任何投资盈亏属个人交易行为，纽克斯集团不对此承担责任，请知悉 For reference only. All investment profits and losses are the result of individual trading decisions. Nexus Group shall not be held responsible. Please be informed.";

function formatPrice(value: number): string {
  if (value === 0) return "\u2014";
  return value.toFixed(value >= 100 ? 2 : 5);
}

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    // MT5 server (TMGM) sends GMT+3 time labeled as UTC.
    // Convert to UTC+8: subtract 3 (to get real UTC) then add 8 = net +5 hours.
    const utc8 = new Date(d.getTime() + 5 * 60 * 60 * 1000);
    return utc8.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC+8");
  } catch {
    return isoString;
  }
}

// ── Family formatters ─────────────────────────────────────────────

function formatExecutionOpen(
  _header: string,
  p: TradeEventPayload,
  classification?: MarketOrderClassification,
): string {
  const slDisplay = p.sl > 0 ? `<b>${formatPrice(p.sl)}</b>` : "\u2014";
  const tpDisplay = p.tp > 0 ? `<b>${formatPrice(p.tp)}</b>` : "\u2014";
  const openHeader = classification?.kind === "add_layer"
    ? "<b>➕ 加倉 Add Position</b>"
    : "<b>\u{1F4CA} \u5E02\u573A\u5355 Market Order</b>";

  return [
    openHeader,
    "",
    `<b>${symbolLabel(p.symbol)}</b>`,
    `<b>${dirLabelMarket(p.direction)}</b>`,
    "",
    `\u{1F4CA} \u5165\u573A\u4EF7\u683C Entry Price: <b>${formatPrice(p.price)}</b>`,
    `\u274C \u9632\u5B88 Stop Loss: ${slDisplay}`,
    `\u{1F3AF} \u6700\u7EC8\u76EE\u6807 Final Take Profit: ${tpDisplay}`,
    "",
    `\u{1F4CC} \u624B\u6570 Volume: ${p.volume.toFixed(2)}`,
    `\u23F0 \u65F6\u95F4 Time: ${formatTime(p.occurred_at)}`,
    p.position_id ? `\u{1F4CA} \u5355\u53F7 Position: ${p.position_id}` : null,
    "",
    DISCLAIMER,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function formatExecutionClose(
  _header: string,
  p: TradeEventPayload,
  overallProfitable?: boolean | null,
): string {
  const openPrice = p.open_price ?? 0;
  const rawTotalVol = p.total_volume ?? 0;
  const isPartial = p.event_type === "POSITION_PARTIALLY_CLOSED" ||
    (rawTotalVol > 0 && rawTotalVol !== p.volume);
  const totalBeforeClose = isPartial ? rawTotalVol + p.volume : rawTotalVol;
  const closePercent = totalBeforeClose > 0
    ? ((p.volume / totalBeforeClose) * 100).toFixed(0)
    : null;

  // Use overall P&L (includes previous partial closes) when available,
  // otherwise fall back to single-close P&L check
  const isProfitable = overallProfitable != null
    ? overallProfitable
    : openPrice > 0 && p.price > 0 && p.direction
      ? (p.direction === "BUY" && p.price > openPrice) ||
        (p.direction === "SELL" && p.price < openPrice)
      : null;
  const closeNearStopLoss =
    p.sl > 0 && p.price > 0 && pipDistance(p.price, p.sl, p.symbol) <= 5;
  const stopLossExitKind = closeNearStopLoss && openPrice > 0 && p.direction
    ? isBreakEvenFromSl({
      direction: p.direction,
      entryPrice: openPrice,
      stopLoss: p.sl,
    })
      ? "breakeven"
      : "stop_loss"
    : null;

  // Determine header and close price label
  let closeHeader: string;
  let closePriceLabel: string;
  if (isPartial) {
    if (isProfitable) {
      closeHeader = "\u{1F4B5} \u6536\u8D70\u90E8\u5206\u5229\u6DA6 Partial Take Profit";
      closePriceLabel = "\u{1F4B5} \u5E73\u4ED3\u4EF7\u683C Close Price";
    } else if (isProfitable === false) {
      closeHeader = "\u{1F4C9} \u90E8\u5206\u6B62\u635F\u79BB\u573A Partial Stop Loss";
      closePriceLabel = "\u{1F4C9} \u5E73\u4ED3\u4EF7\u683C Close Price";
    } else {
      closeHeader = "\u{1F4CA} \u90E8\u5206\u5E73\u4ED3 Partial Close";
      closePriceLabel = "\u{1F4CA} \u5E73\u4ED3\u4EF7\u683C Close Price";
    }
  } else if (stopLossExitKind === "breakeven") {
    closeHeader = "\u{1F6E1} \u4FDD\u62A4\u89E6\u53D1 Break-Even Hit";
    closePriceLabel = "\u{1F6E1} \u5E73\u4ED3\u4EF7\u683C Break-Even";
  } else if (stopLossExitKind === "stop_loss") {
    closeHeader = "\u274C \u6B62\u635F\u79BB\u573A Stop Loss Hit";
    closePriceLabel = "\u274C \u5E73\u4ED3\u4EF7\u683C Stop Loss";
  } else if (isProfitable !== null) {
    if (isProfitable) {
      closeHeader = "\u{1F3C6} \u6B62\u76C8\u79BB\u573A Take Profit Hit";
      closePriceLabel = "\u{1F3AF} \u5E73\u4ED3\u4EF7\u683C Take Profit";
    } else {
      closeHeader = "\u274C \u6B62\u635F\u79BB\u573A Stop Loss Hit";
      closePriceLabel = "\u274C \u5E73\u4ED3\u4EF7\u683C Stop Loss";
    }
  } else {
    closeHeader = "\u{1F534} \u5E73\u4ED3\u79BB\u573A Position Closed";
    closePriceLabel = "\u{1F4CA} \u5E73\u4ED3\u4EF7\u683C Close Price";
  }

  const dir = dirLabelBranded(p.direction);

  // Calculate pips from entry to close
  const pipsLine = openPrice > 0 && p.price > 0 && p.direction
    ? `\u{1F4CA} Pips: <b>${formatPips(calculatePips(openPrice, p.price, p.symbol, p.direction))}</b>`
    : null;

  return [
    `<b>${closeHeader}</b>`,
    "",
    `<b>${symbolLabel(p.symbol)}</b>`,
    `<b>${dir}</b>`,
    "",
    openPrice > 0 ? `\u{1F4CA} \u5F00\u4ED3\u4EF7\u683C Entry Price: <b>${formatPrice(openPrice)}</b>` : null,
    `${closePriceLabel}: <b>${formatPrice(p.price)}</b>`,
    pipsLine,
    `\u{1F4CC} \u5E73\u4ED3\u624B\u6570 Closed Volume: <b>${p.volume.toFixed(2)}</b>${closePercent ? ` (${closePercent}%)` : ""}`,
    totalBeforeClose > 0 ? `\u{1F4CC} \u603B\u624B\u6570 Total Volume: ${totalBeforeClose.toFixed(2)}` : null,
    "",
    `\u23F0 \u65F6\u95F4 Time: ${formatTime(p.occurred_at)}`,
    p.position_id ? `\u{1F4CA} \u5355\u53F7 Position: ${p.position_id}` : null,
    "",
    DISCLAIMER,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function formatPendingOrder(
  _header: string,
  p: TradeEventPayload,
): string {
  const slDisplay = p.sl > 0 ? `<b>${formatPrice(p.sl)}</b>` : "\u2014";
  const tpDisplay = p.tp > 0 ? `<b>${formatPrice(p.tp)}</b>` : "\u2014";

  let pendingHeader: string;
  switch (p.event_type) {
    case "PENDING_ORDER_CANCELLED":
      pendingHeader = "\u274C \u9650\u4EF7\u5355\u5DF2\u53D6\u6D88 Limit Order Cancelled";
      break;
    case "PENDING_ORDER_FILLED":
      pendingHeader = "\u2705 \u9650\u4EF7\u5355\u5DF2\u6210\u4EA4 Limit Order Filled";
      break;
    case "PENDING_ORDER_UPDATED":
      pendingHeader = "\u{1F4DD} \u9650\u4EF7\u5355\u5DF2\u4FEE\u6539 Limit Order Updated";
      break;
    default:
      pendingHeader = "\u{1F4CB} \u9650\u4EF7\u5355 Limit Order";
      break;
  }

  return [
    `<b>${pendingHeader}</b>`,
    "",
    `<b>${symbolLabel(p.symbol)}</b>`,
    `<b>${dirLabelLimit(p.direction)}</b>`,
    "",
    `\u{1F4CA} \u5165\u573A\u4EF7\u683C Entry Price: <b>${formatPrice(p.price)}</b>`,
    `\u274C \u9632\u5B88 Stop Loss: ${slDisplay}`,
    `\u{1F3AF} \u6700\u7EC8\u76EE\u6807 Final Take Profit: ${tpDisplay}`,
    "",
    `\u{1F4CC} \u624B\u6570 Volume: ${p.volume.toFixed(2)}`,
    `\u23F0 \u65F6\u95F4 Time: ${formatTime(p.occurred_at)}`,
    p.order_ticket ? `\u{1F4CA} \u8BA2\u5355 Order: ${p.order_ticket}` : null,
    "",
    DISCLAIMER,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function formatSLTPModification(
  _header: string,
  p: TradeEventPayload,
): string {
  const entryPrice = p.open_price ?? p.price;
  const slDisplay = p.sl > 0 ? `<b>${formatPrice(p.sl)}</b>` : "\u2014";
  const tpDisplay = p.tp > 0 ? `<b>${formatPrice(p.tp)}</b>` : "\u2014";
  const dir = dirLabelBranded(p.direction);

  // Determine header based on event type and break-even detection
  let modHeader: string;
  if (p.event_type === "SL_UPDATED" || p.event_type === "SL_AND_TP_UPDATED") {
    const isBreakEven =
      p.sl > 0 && entryPrice > 0 && p.direction &&
      ((p.direction === "BUY" && p.sl >= entryPrice) ||
       (p.direction === "SELL" && p.sl <= entryPrice));
    if (isBreakEven) {
      modHeader = "\u{1F6E1} \u4FDD\u62A4\u5DF2\u63A8\u4E0A Break-Even Set";
    } else if (p.event_type === "SL_AND_TP_UPDATED") {
      modHeader = "\u{1F4DD} \u9632\u5B88\u548C\u76EE\u6807\u4FEE\u6539 Stop Loss and Take Profit Edited";
    } else {
      modHeader = "\u{1F4DD} \u9632\u5B88\u4FEE\u6539 Stop Loss Edited";
    }
  } else {
    modHeader = "\u{1F4DD} \u76EE\u6807\u4FEE\u6539 Take Profit Edited";
  }

  return [
    `<b>${modHeader}</b>`,
    "",
    `<b>${symbolLabel(p.symbol)}</b>`,
    `<b>${dir}</b>`,
    "",
    entryPrice > 0 ? `\u{1F4CA} \u5165\u573A\u4EF7\u683C Entry Price: <b>${formatPrice(entryPrice)}</b>` : null,
    `\u274C \u9632\u5B88 Stop Loss: ${slDisplay}`,
    `\u{1F3AF} \u6700\u7EC8\u76EE\u6807 Final Take Profit: ${tpDisplay}`,
    "",
    `\u{1F4CC} \u624B\u6570 Volume: ${p.volume.toFixed(2)}`,
    `\u23F0 \u65F6\u95F4 Time: ${formatTime(p.occurred_at)}`,
    p.position_id ? `\u{1F4CA} \u5355\u53F7 Position: ${p.position_id}` : null,
    "",
    DISCLAIMER,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function formatSLTPTriggered(
  _header: string,
  p: TradeEventPayload,
): string {
  const isSL = p.event_type === "STOP_LOSS_TRIGGERED";
  const openPrice = p.open_price ?? 0;

  // Detect break-even hit from the protective stop level, not close price alone.
  const isBreakEvenHit = isSL && openPrice > 0 && p.sl > 0 && p.direction &&
    isBreakEvenFromSl({
      direction: p.direction,
      entryPrice: openPrice,
      stopLoss: p.sl,
    });

  let triggerHeader: string;
  let closePriceLabel: string;
  if (isBreakEvenHit) {
    triggerHeader = "\u{1F6E1} \u4FDD\u62A4\u89E6\u53D1 Break-Even Hit";
    closePriceLabel = "\u{1F6E1} \u5E73\u4ED3\u4EF7\u683C Break-Even";
  } else if (isSL) {
    triggerHeader = "\u274C \u6B62\u635F\u79BB\u573A Stop Loss Hit";
    closePriceLabel = "\u274C \u5E73\u4ED3\u4EF7\u683C Stop Loss";
  } else {
    triggerHeader = "\u{1F3C6} \u6B62\u76C8\u79BB\u573A Take Profit Hit";
    closePriceLabel = "\u{1F3AF} \u5E73\u4ED3\u4EF7\u683C Take Profit";
  }
  const rawTotalVol = p.total_volume ?? 0;
  const totalVol = rawTotalVol > 0 ? rawTotalVol : p.volume;
  const closePercent = totalVol > 0
    ? ((p.volume / totalVol) * 100).toFixed(0)
    : null;
  const dir = dirLabelBranded(p.direction);

  // Calculate pips from entry to close
  const pipsLine = openPrice > 0 && p.price > 0 && p.direction
    ? `\u{1F4CA} Pips: <b>${formatPips(calculatePips(openPrice, p.price, p.symbol, p.direction))}</b>`
    : null;

  return [
    `<b>${triggerHeader}</b>`,
    "",
    `<b>${symbolLabel(p.symbol)}</b>`,
    `<b>${dir}</b>`,
    "",
    openPrice > 0 ? `\u{1F4CA} \u5F00\u4ED3\u4EF7\u683C Entry Price: <b>${formatPrice(openPrice)}</b>` : null,
    `${closePriceLabel}: <b>${formatPrice(p.price)}</b>`,
    pipsLine,
    `\u{1F4CC} \u5E73\u4ED3\u624B\u6570 Closed Volume: <b>${p.volume.toFixed(2)}</b>${closePercent ? ` (${closePercent}%)` : ""}`,
    totalVol > 0 ? `\u{1F4CC} \u603B\u624B\u6570 Total Volume: ${totalVol.toFixed(2)}` : null,
    "",
    `\u23F0 \u65F6\u95F4 Time: ${formatTime(p.occurred_at)}`,
    p.position_id ? `\u{1F4CA} \u5355\u53F7 Position: ${p.position_id}` : null,
    "",
    DISCLAIMER,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
