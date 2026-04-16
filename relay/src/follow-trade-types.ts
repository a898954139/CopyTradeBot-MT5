export interface FollowTradeConfig {
  readonly enabled: boolean;
  readonly lotSize: number;
}

export interface PositionMapping {
  readonly sourcePositionId: string;
  readonly followPositionId: string | null;
  readonly symbol: string;
  readonly direction: string;
  readonly status: "pending" | "open" | "closed";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type FollowTradeResult = {
  readonly processed: boolean;
  readonly action: "opened" | "updated" | "skipped";
  readonly reason: string;
  readonly followPositionId?: string;
};
