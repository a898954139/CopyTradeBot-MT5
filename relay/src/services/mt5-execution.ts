export interface Mt5OrderResult {
  readonly orderId: string;
  readonly positionId: string;
}

export interface Mt5ExecutionService {
  openMarketOrder(symbol: string, direction: 'BUY' | 'SELL', lotSize: number): Promise<Mt5OrderResult>;
  modifyPosition(positionId: string, sl: number, tp: number): Promise<void>;
}

export class LoggingMt5ExecutionService implements Mt5ExecutionService {
  async openMarketOrder(symbol: string, direction: 'BUY' | 'SELL', lotSize: number): Promise<Mt5OrderResult> {
    const positionId = `follow-${Date.now()}`;
    console.log(`[FollowTrade] STUB: openMarketOrder ${direction} ${lotSize} ${symbol} → positionId=${positionId}`);
    return { orderId: positionId, positionId };
  }

  async modifyPosition(positionId: string, sl: number, tp: number): Promise<void> {
    console.log(`[FollowTrade] STUB: modifyPosition ${positionId} SL=${sl} TP=${tp}`);
  }
}

export interface Mt5Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

export class StubMt5ExecutionService implements Mt5ExecutionService {
  readonly calls: Mt5Call[] = [];
  private openResult: Mt5OrderResult = { orderId: 'stub-order-1', positionId: 'stub-pos-1' };
  private shouldFail = false;

  setOpenResult(result: Mt5OrderResult): void {
    this.openResult = result;
  }

  setFailure(fail: boolean): void {
    this.shouldFail = fail;
  }

  async openMarketOrder(symbol: string, direction: 'BUY' | 'SELL', lotSize: number): Promise<Mt5OrderResult> {
    this.calls.push({ method: 'openMarketOrder', args: [symbol, direction, lotSize] });
    if (this.shouldFail) throw new Error('MT5 execution failed');
    return this.openResult;
  }

  async modifyPosition(positionId: string, sl: number, tp: number): Promise<void> {
    this.calls.push({ method: 'modifyPosition', args: [positionId, sl, tp] });
    if (this.shouldFail) throw new Error('MT5 modify failed');
  }
}
