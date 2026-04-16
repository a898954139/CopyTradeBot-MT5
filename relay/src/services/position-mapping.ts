import type Database from "better-sqlite3";
import type { PositionMapping } from "../follow-trade-types.js";

interface MappingRow {
  source_position_id: string;
  follow_position_id: string | null;
  symbol: string;
  direction: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToMapping(row: MappingRow): PositionMapping {
  return {
    sourcePositionId: row.source_position_id,
    followPositionId: row.follow_position_id,
    symbol: row.symbol,
    direction: row.direction,
    status: row.status as PositionMapping["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PositionMappingService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  findBySourcePosition(positionId: string): PositionMapping | null {
    const row = this.db
      .prepare(
        "SELECT * FROM follow_position_mappings WHERE source_position_id = ?",
      )
      .get(positionId) as MappingRow | undefined;

    return row ? rowToMapping(row) : null;
  }

  create(mapping: {
    readonly sourcePositionId: string;
    readonly symbol: string;
    readonly direction: string;
  }): PositionMapping {
    this.db
      .prepare(
        "INSERT INTO follow_position_mappings (source_position_id, symbol, direction, status) VALUES (@src, @sym, @dir, 'pending')",
      )
      .run({
        src: mapping.sourcePositionId,
        sym: mapping.symbol,
        dir: mapping.direction,
      });

    return this.findBySourcePosition(mapping.sourcePositionId)!;
  }

  updateFollowPosition(
    sourcePositionId: string,
    followPositionId: string,
  ): void {
    this.db
      .prepare(
        "UPDATE follow_position_mappings SET follow_position_id = @fid, status = 'open', updated_at = datetime('now') WHERE source_position_id = @sid",
      )
      .run({ fid: followPositionId, sid: sourcePositionId });
  }

  markClosed(sourcePositionId: string): void {
    this.db
      .prepare(
        "UPDATE follow_position_mappings SET status = 'closed', updated_at = datetime('now') WHERE source_position_id = @sid",
      )
      .run({ sid: sourcePositionId });
  }
}
