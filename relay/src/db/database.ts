import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

let db: Database.Database | null = null;

export function getDb(dbPath: string): Database.Database {
  if (db) return db;

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  initSchema(db);
  return db;
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS processed_events (
      idempotency_key TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      telegram_message_id TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_processed_events_received
      ON processed_events(received_at);

    CREATE INDEX IF NOT EXISTS idx_audit_log_key
      ON audit_log(idempotency_key);
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Create a fresh in-memory database for testing */
export function createTestDb(): Database.Database {
  const testDb = new Database(":memory:");
  testDb.pragma("journal_mode = WAL");
  initSchema(testDb);
  return testDb;
}
