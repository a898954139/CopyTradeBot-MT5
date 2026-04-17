# Repository Guidance Summary

## Spectra workflow
This repo uses Spectra for spec-driven development.

- Specs: `openspec/specs/`
- Change proposals: `openspec/changes/`
- Main flow: `discuss? → propose → apply ⇄ ingest → archive`
- Parked changes: use `spectra list --parked` and `spectra unpark <name>` when needed

Use the matching Spectra command style for the active tool surface:
- Claude-style: `/spectra:discuss`, `/spectra:propose`, `/spectra:apply`, `/spectra:ingest`, `/spectra:ask`, `/spectra:archive`
- Agent-style: `$spectra-discuss`, `$spectra-propose`, `$spectra-apply`, `$spectra-ingest`, `$spectra-ask`, `$spectra-archive`

## Project overview
MT5 Expert Advisor captures TMGM-backed MT5 trade events and forwards normalized notifications to Telegram through a relay service.

Flow:
`MT5 EA (MQL5) → Webhook POST → Relay Service (TypeScript/Express) → Telegram Bot API`

## Relay commands (`relay/`)
```bash
npm run dev
npm run build
npm start
npm test
npm run test:watch
npx tsc --noEmit
```

## EA deployment notes
```bash
MT5_MQL5="/Users/anthony/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5"
cp ea/Include/*.mqh "$MT5_MQL5/Include/CopyTradeBot/"
cp ea/Experts/TelegramRelay.mq5 "$MT5_MQL5/Experts/"
```
Compile in MetaEditor after copying.

EA logs are UTF-16LE, for example:
```bash
iconv -f UTF-16LE -t UTF-8 "$MT5_MQL5/Logs/$(date +%Y%m%d).log" | tail -20
```

## Architecture summary
EA pipeline:
`Listener → Normalizer → Classifier → Serializer → Sender`

Important modules:
- `ea/Include/EventNormalizer.mqh` — builds normalized trade-event DTOs
- `ea/Include/EventClassifier.mqh` — classifies pending, execution, and SL/TP events
- `ea/Experts/TelegramRelay.mq5` — main EA with dedup ring buffer and SL/TP cache
- `relay/src/formatters/telegram-formatter.ts` — bilingual Telegram message formatting
- `relay/src/routes/webhook.ts` — webhook intake, dedup, message + sticker dispatch
- `relay/src/services/dedup.ts` — SQLite-backed event dedup / history lookup

## Key business rules
- Close deals are flipped so Telegram shows the original position direction, not the closing deal direction.
- MT5 position updates do not explicitly say whether SL or TP changed, so the EA caches prior values per position.
- Partial close formatting reconstructs total volume from remaining + closed volume.
- Full close may need history lookup to recover original open price.
- Relay currently treats SL at/through entry as breakeven for BE-style messaging.

## Message labels
- Open position → `🟢 開倉 Open Position`
- Partial close profit → `💵 收走部分利潤 Partial TP`
- Full close profit → `💰 止盈出場 Take Profit`
- Full close loss → `📉 止損出場 Stop Loss`
- SL modified → `🛡️ 修改止損 SL Updated`
- Breakeven pushed → `🆙 保護推上 Breakeven+`
- TP modified → `🎯 修改止盈 TP Updated`
- SL triggered → `🚨 止損觸發 SL Triggered`
- TP triggered → `🏆 止盈觸發 TP Triggered`

## Testing and environment
- Tests use `StubTelegramService` and `createTestDb()`.
- Helper utilities live in `relay/tests/helpers.ts`.
- Relay `.env` requires:
  - `WEBHOOK_SECRET`
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`
  - optional `DB_PATH`

## Current implementation note
Webhook auth middleware is still bypassed because MQL5 SHA256 handling is not yet aligned with HMAC-SHA256 expectations.
