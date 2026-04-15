import type Database from "better-sqlite3";

export class AuditService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  log(idempotencyKey: string, action: string, detail?: string): void {
    this.db
      .prepare(
        "INSERT INTO audit_log (idempotency_key, action, detail) VALUES (@key, @action, @detail)",
      )
      .run({ key: idempotencyKey, action, detail: detail ?? null });
  }
}
