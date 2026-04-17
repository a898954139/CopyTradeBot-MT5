import type Database from "better-sqlite3";
import type { TradeEventPayload } from "../types.js";

export interface DedupResult {
  readonly isDuplicate: boolean;
  readonly existingMessageId?: string;
}

export class DedupService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  check(idempotencyKey: string): DedupResult {
    const row = this.db
      .prepare(
        "SELECT telegram_message_id FROM processed_events WHERE idempotency_key = ?",
      )
      .get(idempotencyKey) as
      | { telegram_message_id: string | null }
      | undefined;

    if (row) {
      return {
        isDuplicate: true,
        existingMessageId: row.telegram_message_id ?? undefined,
      };
    }

    return { isDuplicate: false };
  }

  record(payload: TradeEventPayload): void {
    this.db
      .prepare(
        "INSERT INTO processed_events (idempotency_key, event_type, payload) VALUES (@key, @type, @payload)",
      )
      .run({
        key: payload.idempotency_key,
        type: payload.event_type,
        payload: JSON.stringify(payload),
      });
  }

  /** Find all previous close events for a position to calculate overall P&L */
  getPositionCloses(positionId: string): TradeEventPayload[] {
    const rows = this.db
      .prepare(
        `SELECT payload FROM processed_events
         WHERE event_type IN ('POSITION_PARTIALLY_CLOSED', 'POSITION_CLOSED')
         AND json_extract(payload, '$.position_id') = ?`,
      )
      .all(positionId) as { payload: string }[];

    return rows.map((r) => JSON.parse(r.payload) as TradeEventPayload);
  }

  /**
   * Find the most recent close-family event for the same position within the
   * given window. Used to aggregate broker-fragmented fills (e.g. a 2.00 lot
   * TP closed as 2x1.00 deals within milliseconds of each other).
   */
  findRecentCloseSibling(
    positionId: string,
    windowSeconds: number,
  ): {
    idempotencyKey: string;
    messageId: string;
    payload: TradeEventPayload;
  } | null {
    const row = this.db
      .prepare(
        `SELECT idempotency_key, telegram_message_id, payload
         FROM processed_events
         WHERE event_type IN (
           'POSITION_PARTIALLY_CLOSED',
           'POSITION_CLOSED',
           'STOP_LOSS_TRIGGERED',
           'TAKE_PROFIT_TRIGGERED'
         )
         AND json_extract(payload, '$.position_id') = ?
         AND telegram_message_id IS NOT NULL
         AND received_at >= datetime('now', ?)
         ORDER BY received_at ASC, rowid ASC
         LIMIT 1`,
      )
      .get(positionId, `-${windowSeconds} seconds`) as
      | {
          idempotency_key: string;
          telegram_message_id: string;
          payload: string;
        }
      | undefined;

    if (!row) return null;
    return {
      idempotencyKey: row.idempotency_key,
      messageId: row.telegram_message_id,
      payload: JSON.parse(row.payload) as TradeEventPayload,
    };
  }

  /** Persist the aggregated payload back to the sibling row so subsequent
   *  fragments continue to aggregate against the combined state. */
  updateAggregatedPayload(
    idempotencyKey: string,
    aggregated: TradeEventPayload,
  ): void {
    this.db
      .prepare(
        "UPDATE processed_events SET payload = @payload WHERE idempotency_key = @key",
      )
      .run({ payload: JSON.stringify(aggregated), key: idempotencyKey });
  }

  updateMessageId(idempotencyKey: string, messageId: string): void {
    this.db
      .prepare(
        "UPDATE processed_events SET telegram_message_id = @msgId WHERE idempotency_key = @key",
      )
      .run({ msgId: messageId, key: idempotencyKey });
  }
}
