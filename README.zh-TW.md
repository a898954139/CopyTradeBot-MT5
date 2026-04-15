# MT5 跟單交易 Telegram 機器人

MT5 Expert Advisor，從 TMGM MT5 帳戶捕捉交易事件，透過中繼服務推送雙語（英文 + 繁體中文）通知至 Telegram。

**流程：** MT5 EA (MQL5) → Webhook POST → 中繼服務 (TypeScript/Express) → Telegram Bot API

## 環境需求

- **Node.js** v20+（建議使用 [nvm](https://github.com/nvm-sh/nvm)）
- **MetaTrader 5**（Windows 或 Mac Wine 版）
- 一個 **Telegram Bot**（透過 [@BotFather](https://t.me/BotFather) 建立）
- 接收通知的 Telegram **Chat ID**

## 專案結構

```
copyTradeBot/
├── ea/                        # MT5 Expert Advisor (MQL5)
│   ├── Experts/
│   │   └── TelegramRelay.mq5  # EA 主程式
│   └── Include/
│       ├── EventNormalizer.mqh # 原始事件 → DTO 轉換
│       ├── EventClassifier.mqh # 交易事件分類
│       ├── JsonSerializer.mqh  # DTO → JSON 序列化
│       ├── WebhookClient.mqh   # HMAC 簽章 HTTP POST
│       ├── RetryQueue.mqh      # 失敗重試佇列
│       ├── IdempotencyKeyBuilder.mqh
│       ├── TradeEventDTO.mqh
│       ├── Enums.mqh
│       └── Logger.mqh
└── relay/                     # Webhook 中繼服務
    └── src/
        ├── index.ts           # 進入點
        ├── app.ts             # Express 應用程式設定
        ├── config.ts          # 環境變數載入
        ├── routes/webhook.ts  # POST /webhooks/mt5/events
        ├── services/
        │   ├── telegram.ts    # Telegram Bot API 客戶端
        │   ├── dedup.ts       # 冪等去重（SQLite）
        │   └── audit.ts       # 事件稽核日誌
        ├── formatters/
        │   └── telegram-formatter.ts  # 雙語訊息格式化
        ├── middleware/auth.ts  # HMAC 驗證（目前已暫停）
        ├── db/database.ts     # SQLite + WAL 設定
        └── types.ts
```

## 安裝步驟

### 1. 中繼服務

```bash
cd relay

# 安裝套件
npm install

# 從範本建立 .env
cp .env.example .env
```

編輯 `.env`：

```env
PORT=3000
WEBHOOK_SECRET=自訂共享密鑰
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...    # 從 @BotFather 取得
TELEGRAM_CHAT_ID=-100xxxxxxxxxx          # 群組/頻道 ID
DB_PATH=./data/relay.db
```

#### 取得 Telegram Chat ID

1. 將機器人加入目標群組/頻道
2. 在該群組發送一則訊息
3. 開啟 `https://api.telegram.org/bot<你的BOT_TOKEN>/getUpdates`
4. 找到 `"chat":{"id":-100xxxxxxxxxx}` — 這就是你的 Chat ID

#### 啟動中繼服務

```bash
# 開發模式（熱重載）
npm run dev

# 正式環境
npm run build
npm start
```

#### 驗證是否運行中

```bash
curl http://localhost:3000/health
# 應回傳：{"status":"ok"}
```

### 2. 背景服務執行（建議）

使用 [pm2](https://pm2.keymetrics.io/)：

```bash
# 全域安裝 pm2
npm install -g pm2

# 啟動中繼服務
cd relay
pm2 start npm --name "copy-trade-relay" -- start

# 開機自動啟動
pm2 startup
pm2 save

# 常用指令
pm2 status                    # 查看狀態
pm2 logs copy-trade-relay     # 查看日誌
pm2 restart copy-trade-relay  # 重啟
pm2 stop copy-trade-relay     # 停止
```

### 3. MT5 Expert Advisor

#### 安裝 EA 檔案

將檔案複製到 MT5 的 MQL5 目錄：

```bash
# 找到你的 MT5 MQL5 路徑：
#   Windows: C:\Users\<使用者>\AppData\Roaming\MetaQuotes\Terminal\<hash>\MQL5
#   Mac (Wine): ~/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5

# 建立 Include 子資料夾
mkdir -p "$MQL5_PATH/Include/CopyTradeBot"

# 複製檔案
cp ea/Include/*.mqh "$MQL5_PATH/Include/CopyTradeBot/"
cp ea/Experts/TelegramRelay.mq5 "$MQL5_PATH/Experts/"
```

#### 編譯

1. 開啟 MetaEditor（在 MT5 中按 F4）
2. 開啟 `Experts/TelegramRelay.mq5`
3. 編譯（F7）

#### 設定 EA

1. 將 `TelegramRelay` 拖到圖表上
2. 在 **Inputs** 分頁設定：
   - `InpRelayURL` = `http://<中繼服務IP>:3000/webhooks/mt5/events`
   - `InpWebhookSecret` = 與 `.env` 中 `WEBHOOK_SECRET` 相同的值
3. 在 MT5 中：**工具 → 選項 → Expert Advisors** → 將 `http://<中繼服務IP>:3000` 加入允許的 URL 清單
4. 啟用 **自動交易**（工具列上的按鈕）

> **重要：** 中繼服務的 IP 必須能被 MT5 機器存取。若在同一區域網路，使用區域 IP（如 `192.168.1.x`）。若在遠端，需要設定通訊埠轉發或通道。

### 4. 網路檢查清單

- [ ] 中繼服務機器防火牆允許 3000 埠的入站連線
- [ ] MT5 機器能連到中繼服務 IP:3000（用 `ping` / `curl` 測試）
- [ ] MT5 已將中繼服務 URL 加入白名單（工具 → 選項 → Expert Advisors）
- [ ] Telegram 機器人已加入目標群組

## 訊息格式

| 情境 | 通知 |
|------|------|
| 開倉 | 🟢 開倉 Open Position |
| 部分平倉 | 💵 收走部分利潤 Partial TP |
| 全部平倉 + 獲利 | 💰 止盈出場 Take Profit |
| 全部平倉 + 虧損 | 📉 止損出場 Stop Loss |
| 止損低於入場價 | 🛡️ 修改止損 SL Updated |
| 止損在入場價以上 (BUY) | 🆙 保護推上 Breakeven+ |
| 修改止盈 | 🎯 修改止盈 TP Updated |
| 止損觸發 | 🚨 止損觸發 SL Triggered |
| 止盈觸發 | 🏆 止盈觸發 TP Triggered |

## 開發

```bash
cd relay

npm run dev          # 開發伺服器（熱重載）
npm test             # 執行測試
npm run test:watch   # 監聽模式
npx tsc --noEmit     # 僅型別檢查
```

## 疑難排解

| 問題 | 解決方式 |
|------|---------|
| `curl localhost:3000/health` 失敗 | 中繼服務未啟動 — 檢查 `pm2 status` 或用 `npm run dev` 啟動 |
| EA 日誌顯示 "WebRequest failed" | 將中繼服務 URL 加入 MT5 允許清單（工具 → 選項 → Expert Advisors） |
| EA 日誌顯示 "URL not configured" | 檢查 EA 輸入參數 `InpRelayURL` 是否已設定 |
| 沒收到 Telegram 訊息 | 確認 `.env` 中的 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_CHAT_ID`；確認機器人在群組中 |
| 重複訊息 | 正常運作 — 去重服務會透過 SQLite 過濾 |
| EA 日誌亂碼 | 日誌為 UTF-16LE 編碼：`iconv -f UTF-16LE -t UTF-8 <日誌檔>` |
