import { z } from "zod";

// ── Business Event Types ──────────────────────────────────────────
export const BUSINESS_EVENTS = [
  "POSITION_OPENED",
  "POSITION_INCREASED",
  "POSITION_PARTIALLY_CLOSED",
  "POSITION_CLOSED",
  "SL_UPDATED",
  "TP_UPDATED",
  "SL_AND_TP_UPDATED",
  "STOP_LOSS_TRIGGERED",
  "TAKE_PROFIT_TRIGGERED",
  "PENDING_ORDER_CREATED",
  "PENDING_ORDER_UPDATED",
  "PENDING_ORDER_CANCELLED",
  "PENDING_ORDER_FILLED",
] as const;

export type BusinessEvent = (typeof BUSINESS_EVENTS)[number];

// ── Inbound Webhook Payload Schema ────────────────────────────────
export const tradeEventSchema = z.object({
  source: z.string(),
  account: z.string(),
  server: z.string(),
  terminal_id: z.string(),
  event_type: z.enum(BUSINESS_EVENTS),
  idempotency_key: z.string().min(1),
  occurred_at: z.string(),
  symbol: z.string(),
  position_id: z.string().nullable(),
  order_ticket: z.string().nullable(),
  deal_ticket: z.string().nullable(),
  direction: z.enum(["BUY", "SELL"]).nullable(),
  volume: z.coerce.number().nonnegative(),
  price: z.coerce.number().nonnegative(),
  sl: z.coerce.number().nonnegative(),
  tp: z.coerce.number().nonnegative(),
  open_price: z.coerce.number().nonnegative().optional().default(0),
  total_volume: z.coerce.number().nonnegative().optional().default(0),
  reason: z.string(),
  comment: z.string(),
  magic: z.coerce.number().int(),
  correlation_id: z.string().nullable(),
  raw: z.record(z.unknown()).optional(),
});

export type TradeEventPayload = z.infer<typeof tradeEventSchema>;

// ── Relay Response ────────────────────────────────────────────────
export interface RelayResponse {
  readonly ok: boolean;
  readonly duplicate: boolean;
  readonly accepted: boolean;
  readonly message_id?: string;
  readonly error?: string;
}
