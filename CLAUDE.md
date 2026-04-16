<!-- SPECTRA:START v1.0.1 -->

# Spectra Instructions

This project uses Spectra for Spec-Driven Development(SDD). Specs live in `openspec/specs/`, change proposals in `openspec/changes/`.

## Use `/spectra:*` skills when:

- A discussion needs structure before coding → `/spectra:discuss`
- User wants to plan, propose, or design a change → `/spectra:propose`
- Tasks are ready to implement → `/spectra:apply`
- There's an in-progress change to continue → `/spectra:ingest`
- User asks about specs or how something works → `/spectra:ask`
- Implementation is done → `/spectra:archive`

## Workflow

discuss? → propose → apply ⇄ ingest → archive

- `discuss` is optional — skip if requirements are clear
- Requirements change mid-work? Plan mode → `ingest` → resume `apply`

## Parked Changes

Changes can be parked（暫存）— temporarily moved out of `openspec/changes/`. Parked changes won't appear in `spectra list` but can be found with `spectra list --parked`. To restore: `spectra unpark <name>`. The `/spectra:apply` and `/spectra:ingest` skills handle parked changes automatically.

<!-- SPECTRA:END -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MT5 Expert Advisor that captures trade events from a TMGM-backed MT5 account and pushes normalized notifications to Telegram through a relay service.

**Flow:** MT5 EA (MQL5) → Webhook POST → Relay Service (TypeScript/Express) → Telegram Bot API

## Commands

### Relay Service (from `relay/` directory)

```bash
npm run dev          # Development with hot reload (tsx watch)
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled output
npm test             # Run all tests (vitest)
npm run test:watch   # Watch mode
npx tsc --noEmit     # Type check without emitting
```

### EA Deployment (copy files to MT5 Mac Wine path)

```bash
MT5_MQL5="/Users/anthony/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5"
cp ea/Include/*.mqh "$MT5_MQL5/Include/CopyTradeBot/"
cp ea/Experts/TelegramRelay.mq5 "$MT5_MQL5/Experts/"
# Then compile in MetaEditor (F4 to open, F7 to compile)
```

### Reading EA Logs (UTF-16LE encoded)

```bash
iconv -f UTF-16LE -t UTF-8 "$MT5_MQL5/Logs/$(date +%Y%m%d).log" | tail -20
```

## Architecture

### EA Modules (`ea/Include/`)

The EA follows a strict pipeline: **Listener → Normalizer → Classifier → Serializer → Sender**.

- `EventNormalizer.mqh` — Transforms raw `MqlTradeTransaction` into `NormalizedTradeEventCandidate` DTO. Enriches from deal history, order, and position APIs. For OUT deals, flips deal direction to report original position direction.
- `EventClassifier.mqh` — Table-driven 3-step classification: (1) pending order lifecycle via `TRADE_TRANSACTION_ORDER_ADD/UPDATE/DELETE`, (2) deal-based execution via `TRADE_TRANSACTION_DEAL_ADD`, (3) SL/TP modification via `TRADE_TRANSACTION_POSITION`.
- `TelegramRelay.mq5` — Main EA. Maintains a 256-entry dedup ring buffer and 64-entry SL/TP cache per position (to distinguish SL vs TP changes since MT5 doesn't tell you which field changed).

### Relay Service (`relay/src/`)

- Auth middleware currently **bypassed** (MQL5's `CryptEncode` does SHA256 not HMAC-SHA256). TODO: fix HMAC alignment.
- `telegram-formatter.ts` — Family-based formatting with bilingual labels (English + Traditional Chinese). Key business logic: partial close always shows "收走部分利潤", full close judges profit/loss based on direction + entry vs close price. SL >= entry price (BUY) = "保護推上 Breakeven+".
- SQLite with WAL mode for dedup (`processed_events` table, PK on `idempotency_key`).

## Key Design Decisions

- **Direction on close events**: The closing deal's type is opposite to position (SELL deal closes BUY position). EA flips this so Telegram always shows the original position direction.
- **SL/TP cache**: MT5's `TRADE_TRANSACTION_POSITION` event carries both SL and TP values but doesn't indicate which changed. EA caches previous values per position to detect which field actually changed.
- **total_volume for partial close**: Position's `POSITION_VOLUME` after a partial close is the *remaining* volume. Formatter adds closed volume back to compute the original total: `totalBeforeClose = remaining + closed`.
- **open_price on full close**: When position is fully closed, `PositionSelectByTicket` fails. EA falls back to `HistorySelectByPosition` to find the opening deal's price.

## Message Format Rules

| Scenario | Label |
|----------|-------|
| Open position | 🟢 開倉 Open Position |
| Partial close (always profitable) | 💵 收走部分利潤 Partial TP |
| Full close + profit | 💰 止盈出場 Take Profit |
| Full close + loss | 📉 止損出場 Stop Loss |
| SL below entry (BUY) / above entry (SELL) | 🛡️ 修改止損 SL Updated |
| SL >= entry (BUY) / <= entry (SELL) | 🆙 保護推上 Breakeven+ |
| TP modified | 🎯 修改止盈 TP Updated |
| SL triggered | 🚨 止損觸發 SL Triggered |
| TP triggered | 🏆 止盈觸發 TP Triggered |

## Follow-Trade (Baseline)

Copies manual trades from the source MT5 account to a follow account. Disabled by default — set `FOLLOW_TRADING_ENABLED=true` to activate.

### In-Scope

- **Open**: Manual market orders (`magic === 0`, `POSITION_OPENED`) are copied as a market order on the follow account with fixed lot size (`FOLLOW_LOT_SIZE`, default `0.01`). No SL/TP is placed on the initial open.
- **SL/TP relay**: Later `SL_UPDATED` / `TP_UPDATED` events are forwarded to the follow position via `modifyPosition`, but only when a live mapping exists (status `open`).
- **Dedup**: `position_id` is the primary key in `follow_position_mappings`. Duplicate open events for the same source position are skipped.
- **Audit**: All actions (skip, open, update, fail) are logged to `audit_log`. Failures include an `ALERT:` prefix for monitoring.
- **Non-blocking**: Follow-trade processing runs after the Telegram notification and never blocks the webhook response.

### Out-of-Scope (Future)

- Pending / limit orders (only market orders are copied).
- Position close mirroring (close events are not forwarded).
- Partial close handling on the follow account.
- Dynamic lot sizing or risk-based sizing (fixed lot only).
- Multi-account fan-out (single follow account).
- Real MT5 execution — `Mt5ExecutionService` is currently a logging stub (`LoggingMt5ExecutionService`). A real implementation (e.g. MT5 Manager API or second EA) is required for live trading.

### Config / Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FOLLOW_TRADING_ENABLED` | No | `false` | Global on/off switch |
| `FOLLOW_LOT_SIZE` | No | `0.01` | Fixed lot size for follow orders |

### Safety Notes

- The feature is **off by default**. Enabling it with the stub executor only logs intended actions — no real orders are placed.
- Position mappings persist in SQLite (`follow_position_mappings` table). If the relay restarts, existing mappings survive and SL/TP updates continue to route correctly.
- If the MT5 execution call fails, the error is logged with `ALERT:` and the webhook still returns success (notification was already sent).

## Testing

Tests use `StubTelegramService` (captures messages without API calls) and `createTestDb()` (in-memory SQLite). Test helpers in `tests/helpers.ts` provide `buildPayload()` and `makeHeaders()` for constructing signed requests.

## Environment

Relay `.env` requires: `WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Optional: `FOLLOW_TRADING_ENABLED`, `FOLLOW_LOT_SIZE`. See `.env.example`.
