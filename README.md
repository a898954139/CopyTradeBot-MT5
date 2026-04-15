# MT5 Copy Trade Telegram Bot

**[繁體中文](README.zh-TW.md)** | **[简体中文](README.zh-CN.md)**

MT5 Expert Advisor that captures trade events from a TMGM-backed MT5 account and pushes bilingual (English + Traditional Chinese) notifications to Telegram through a relay service.

**Flow:** MT5 EA (MQL5) → Webhook POST → Relay Service (TypeScript/Express) → Telegram Bot API

## Prerequisites

- **Node.js** v20+ (recommend using [nvm](https://github.com/nvm-sh/nvm))
- **MetaTrader 5** (Windows or Mac via Wine)
- A **Telegram Bot** (created via [@BotFather](https://t.me/BotFather))
- The Telegram **Chat ID** where notifications should go

## Project Structure

```
copyTradeBot/
├── ea/                        # MT5 Expert Advisor (MQL5)
│   ├── Experts/
│   │   └── TelegramRelay.mq5  # Main EA entry point
│   └── Include/
│       ├── EventNormalizer.mqh # Raw event → DTO transformation
│       ├── EventClassifier.mqh # Trade event classification
│       ├── JsonSerializer.mqh  # DTO → JSON serialization
│       ├── WebhookClient.mqh   # HMAC-signed HTTP POST
│       ├── RetryQueue.mqh      # Failed delivery retry queue
│       ├── IdempotencyKeyBuilder.mqh
│       ├── TradeEventDTO.mqh
│       ├── Enums.mqh
│       └── Logger.mqh
└── relay/                     # Webhook relay service
    └── src/
        ├── index.ts           # Entry point
        ├── app.ts             # Express app setup
        ├── config.ts          # Env var loader
        ├── routes/webhook.ts  # POST /webhooks/mt5/events
        ├── services/
        │   ├── telegram.ts    # Telegram Bot API client
        │   ├── dedup.ts       # Idempotency dedup (SQLite)
        │   └── audit.ts       # Event audit log
        ├── formatters/
        │   └── telegram-formatter.ts  # Bilingual message formatting
        ├── middleware/auth.ts  # HMAC auth (currently bypassed)
        ├── db/database.ts     # SQLite + WAL setup
        └── types.ts
```

## Setup

### 1. Relay Service

```bash
cd relay

# Install dependencies
npm install

# Create .env from template (must be inside relay/ directory)
cp .env.example .env
```

Edit `relay/.env` with your values:

```env
PORT=3000
WEBHOOK_SECRET=pick-any-shared-secret
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...    # From @BotFather
TELEGRAM_CHAT_ID=-100xxxxxxxxxx          # Your group/channel ID
DB_PATH=./data/relay.db
```

#### Getting your Telegram Chat ID

1. Add your bot to the target group/channel
2. Send a message in that group
3. Visit `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
4. Look for `"chat":{"id":-100xxxxxxxxxx}` — that's your Chat ID

#### Run the relay

```bash
# Development (hot reload)
npm run dev

# Production
npm run build
npm start
```

#### Verify it's running

```bash
curl http://localhost:3000/health
# Should return: {"status":"ok"}
```

### 2. Run as Background Service (recommended)

Using [pm2](https://pm2.keymetrics.io/):

```bash
# Install pm2 globally
npm install -g pm2

# Start the relay
cd relay
pm2 start npm --name "copy-trade-relay" -- start

# Auto-restart on reboot
pm2 startup
pm2 save

# Useful commands
pm2 status                    # Check if running
pm2 logs copy-trade-relay     # View logs
pm2 restart copy-trade-relay  # Restart
pm2 stop copy-trade-relay     # Stop
```

### 3. MT5 Expert Advisor

#### Install EA files

Copy files into your MT5 MQL5 directory:

```bash
# Find your MT5 MQL5 path:
#   Windows: C:\Users\<you>\AppData\Roaming\MetaQuotes\Terminal\<hash>\MQL5
#   Mac (Wine): ~/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5

# Create the Include subfolder
mkdir -p "$MQL5_PATH/Include/CopyTradeBot"

# Copy files
cp ea/Include/*.mqh "$MQL5_PATH/Include/CopyTradeBot/"
cp ea/Experts/TelegramRelay.mq5 "$MQL5_PATH/Experts/"
```

#### Compile

1. Open MetaEditor (F4 from MT5)
2. Open `Experts/TelegramRelay.mq5`
3. Compile (F7)

#### Configure EA

1. Drag `TelegramRelay` onto a chart
2. In the **Inputs** tab, set:
   - `InpRelayURL` = `http://<relay-machine-ip>:3000/webhooks/mt5/events`
   - `InpWebhookSecret` = same value as `WEBHOOK_SECRET` in `.env`
3. In MT5: **Tools → Options → Expert Advisors** → add `http://<relay-machine-ip>:3000` to the Allowed URLs list
4. Enable **AutoTrading** (button in toolbar)

> **Important:** The relay machine's IP must be reachable from the MT5 machine. If they're on the same LAN, use the local IP (e.g., `192.168.1.x`). If remote, you'll need port forwarding or a tunnel.

### 4. Network Checklist

- [ ] Relay machine firewall allows inbound on port 3000
- [ ] MT5 machine can reach relay IP:3000 (`ping` / `curl` to test)
- [ ] MT5 has the relay URL whitelisted in Tools → Options → Expert Advisors
- [ ] Telegram bot has been added to the target chat/group

## Message Format

| Scenario | Notification |
|----------|-------------|
| Open position | 🟢 開倉 Open Position |
| Partial close | 💵 收走部分利潤 Partial TP |
| Full close + profit | 💰 止盈出場 Take Profit |
| Full close + loss | 📉 止損出場 Stop Loss |
| SL below entry | 🛡️ 修改止損 SL Updated |
| SL at/above entry (BUY) | 🆙 保護推上 Breakeven+ |
| TP modified | 🎯 修改止盈 TP Updated |
| SL triggered | 🚨 止損觸發 SL Triggered |
| TP triggered | 🏆 止盈觸發 TP Triggered |

## Development

```bash
cd relay

npm run dev          # Dev server with hot reload
npm test             # Run tests
npm run test:watch   # Watch mode
npx tsc --noEmit     # Type check only
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `curl localhost:3000/health` fails | Relay not running — check `pm2 status` or start with `npm run dev` |
| EA log says "WebRequest failed" | Add relay URL to MT5 allowed URLs (Tools → Options → Expert Advisors) |
| EA log says "URL not configured" | Check EA input `InpRelayURL` is set |
| No Telegram messages | Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`; check bot is in the chat |
| Duplicate messages | Working as intended — dedup service filters them via SQLite |
| EA logs are garbled | Logs are UTF-16LE: `iconv -f UTF-16LE -t UTF-8 <logfile>` |
