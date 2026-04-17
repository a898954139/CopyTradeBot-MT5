import type { TradeEventPayload } from "../types.js";

export interface TrackedOrder {
  readonly positionId: string;
  readonly symbol: string;
  readonly direction: "BUY" | "SELL";
  readonly entryPrice: number;
  readonly stopLoss: number;
  readonly isBreakEven: boolean;
  readonly isClosed: boolean;
}

export interface MarketOrderClassification {
  readonly kind: "new_order" | "add_layer";
  readonly matchedPositionId?: string;
}

export function isBreakEvenFromSl(input: {
  direction: "BUY" | "SELL";
  entryPrice: number;
  stopLoss: number;
}): boolean {
  const { direction, entryPrice, stopLoss } = input;
  if (entryPrice <= 0 || stopLoss <= 0) return false;
  return direction === "BUY"
    ? stopLoss >= entryPrice
    : stopLoss <= entryPrice;
}

export function deriveTrackedOrders(
  events: readonly TradeEventPayload[],
): TrackedOrder[] {
  const tracked = new Map<string, TrackedOrder>();

  for (const event of events) {
    const positionId = event.position_id;
    if (!positionId || !event.direction) continue;

    const existing = tracked.get(positionId);

    switch (event.event_type) {
      case "POSITION_OPENED":
      case "POSITION_INCREASED": {
        const entryPrice = existing?.entryPrice ?? event.open_price ?? event.price;
        const stopLoss = event.sl > 0 ? event.sl : (existing?.stopLoss ?? 0);
        tracked.set(positionId, {
          positionId,
          symbol: event.symbol,
          direction: event.direction,
          entryPrice,
          stopLoss,
          isBreakEven: isBreakEvenFromSl({
            direction: event.direction,
            entryPrice,
            stopLoss,
          }),
          isClosed: false,
        });
        break;
      }

      case "SL_UPDATED":
      case "SL_AND_TP_UPDATED": {
        if (!existing) break;
        const entryPrice = existing.entryPrice || event.open_price || event.price;
        const stopLoss = event.sl > 0 ? event.sl : existing.stopLoss;
        tracked.set(positionId, {
          ...existing,
          entryPrice,
          stopLoss,
          isBreakEven: isBreakEvenFromSl({
            direction: existing.direction,
            entryPrice,
            stopLoss,
          }),
        });
        break;
      }

      case "POSITION_CLOSED":
      case "STOP_LOSS_TRIGGERED":
      case "TAKE_PROFIT_TRIGGERED": {
        if (!existing) break;
        tracked.set(positionId, { ...existing, isClosed: true });
        break;
      }

      default:
        break;
    }
  }

  return [...tracked.values()].filter((order) => !order.isClosed);
}

export function classifyMarketOrder(
  payload: Pick<TradeEventPayload, "symbol" | "direction" | "price">,
  trackedOrders: readonly TrackedOrder[],
): MarketOrderClassification {
  if (!payload.direction || payload.price <= 0) {
    return { kind: "new_order" };
  }

  const match = trackedOrders
    .filter((order) =>
      order.symbol === payload.symbol &&
      order.direction === payload.direction &&
      !order.isBreakEven &&
      order.stopLoss > 0 &&
      Math.abs(payload.price - order.stopLoss) <= 10.0,
    )
    .sort((left, right) =>
      Math.abs(payload.price - left.stopLoss) -
      Math.abs(payload.price - right.stopLoss),
    )[0];

  if (!match) {
    return { kind: "new_order" };
  }

  return {
    kind: "add_layer",
    matchedPositionId: match.positionId,
  };
}

export function classifyMarketOrderFromHistory(
  payload: Pick<TradeEventPayload, "symbol" | "direction" | "price">,
  events: readonly TradeEventPayload[],
): MarketOrderClassification {
  return classifyMarketOrder(payload, deriveTrackedOrders(events));
}
