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

  updateMessageId(idempotencyKey: string, messageId: string): void {
    this.db
      .prepare(
        "UPDATE processed_events SET telegram_message_id = @msgId WHERE idempotency_key = @key",
      )
      .run({ msgId: messageId, key: idempotencyKey });
  }
}
