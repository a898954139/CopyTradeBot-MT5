# MT5 跟单交易 Telegram 机器人

MT5 Expert Advisor，从 TMGM MT5 账户捕捉交易事件，通过中继服务推送双语（英文 + 繁体中文）通知至 Telegram。

**流程：** MT5 EA (MQL5) → Webhook POST → 中继服务 (TypeScript/Express) → Telegram Bot API

## 环境要求

- **Node.js** v20+（建议使用 [nvm](https://github.com/nvm-sh/nvm)）
- **MetaTrader 5**（Windows 或 Mac Wine 版）
- 一个 **Telegram Bot**（通过 [@BotFather](https://t.me/BotFather) 创建）
- 接收通知的 Telegram **Chat ID**

## 项目结构

```
copyTradeBot/
├── ea/                        # MT5 Expert Advisor (MQL5)
│   ├── Experts/
│   │   └── TelegramRelay.mq5  # EA 主程序
│   └── Include/
│       ├── EventNormalizer.mqh # 原始事件 → DTO 转换
│       ├── EventClassifier.mqh # 交易事件分类
│       ├── JsonSerializer.mqh  # DTO → JSON 序列化
│       ├── WebhookClient.mqh   # HMAC 签名 HTTP POST
│       ├── RetryQueue.mqh      # 失败重试队列
│       ├── IdempotencyKeyBuilder.mqh
│       ├── TradeEventDTO.mqh
│       ├── Enums.mqh
│       └── Logger.mqh
└── relay/                     # Webhook 中继服务
    └── src/
        ├── index.ts           # 入口
        ├── app.ts             # Express 应用设置
        ├── config.ts          # 环境变量加载
        ├── routes/webhook.ts  # POST /webhooks/mt5/events
        ├── services/
        │   ├── telegram.ts    # Telegram Bot API 客户端
        │   ├── dedup.ts       # 幂等去重（SQLite）
        │   └── audit.ts       # 事件审计日志
        ├── formatters/
        │   └── telegram-formatter.ts  # 双语消息格式化
        ├── middleware/auth.ts  # HMAC 验证（当前已暂停）
        ├── db/database.ts     # SQLite + WAL 设置
        └── types.ts
```

## 安装步骤

### 1. 中继服务

```bash
cd relay

# 安装依赖
npm install

# 从模板创建 .env（必须放在 relay/ 目录内）
cp .env.example .env
```

编辑 `relay/.env`：

```env
PORT=3000
WEBHOOK_SECRET=自定义共享密钥
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...    # 从 @BotFather 获取
TELEGRAM_CHAT_ID=-100xxxxxxxxxx          # 群组/频道 ID
DB_PATH=./data/relay.db
```

#### 获取 Telegram Chat ID

1. 将机器人添加到目标群组/频道
2. 在该群组发送一条消息
3. 打开 `https://api.telegram.org/bot<你的BOT_TOKEN>/getUpdates`
4. 找到 `"chat":{"id":-100xxxxxxxxxx}` — 这就是你的 Chat ID

#### 启动中继服务

```bash
# 开发模式（热重载）
npm run dev

# 生产环境
npm run build
npm start
```

#### 验证是否运行中

```bash
curl http://localhost:3000/health
# 应返回：{"status":"ok"}
```

### 2. 后台服务运行（推荐）

使用 [pm2](https://pm2.keymetrics.io/)：

```bash
# 全局安装 pm2
npm install -g pm2

# 启动中继服务
cd relay
pm2 start npm --name "copy-trade-relay" -- start

# 开机自动启动
pm2 startup
pm2 save

# 常用命令
pm2 status                    # 查看状态
pm2 logs copy-trade-relay     # 查看日志
pm2 restart copy-trade-relay  # 重启
pm2 stop copy-trade-relay     # 停止
```

### 3. MT5 Expert Advisor

#### 安装 EA 文件

将文件复制到 MT5 的 MQL5 目录：

```bash
# 找到你的 MT5 MQL5 路径：
#   Windows: C:\Users\<用户名>\AppData\Roaming\MetaQuotes\Terminal\<hash>\MQL5
#   Mac (Wine): ~/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5

# 创建 Include 子文件夹
mkdir -p "$MQL5_PATH/Include/CopyTradeBot"

# 复制文件
cp ea/Include/*.mqh "$MQL5_PATH/Include/CopyTradeBot/"
cp ea/Experts/TelegramRelay.mq5 "$MQL5_PATH/Experts/"
```

#### 编译

1. 打开 MetaEditor（在 MT5 中按 F4）
2. 打开 `Experts/TelegramRelay.mq5`
3. 编译（F7）

#### 配置 EA

1. 将 `TelegramRelay` 拖到图表上
2. 在 **Inputs** 标签页设置：
   - `InpRelayURL` = `http://<中继服务IP>:3000/webhooks/mt5/events`
   - `InpWebhookSecret` = 与 `.env` 中 `WEBHOOK_SECRET` 相同的值
3. 在 MT5 中：**工具 → 选项 → Expert Advisors** → 将 `http://<中继服务IP>:3000` 添加到允许的 URL 列表
4. 启用 **自动交易**（工具栏上的按钮）

> **重要：** 中继服务的 IP 必须能被 MT5 机器访问。如果在同一局域网，使用本地 IP（如 `192.168.1.x`）。如果在远程，需要设置端口转发或隧道。

### 4. 网络检查清单

- [ ] 中继服务机器防火墙允许 3000 端口的入站连接
- [ ] MT5 机器能连到中继服务 IP:3000（用 `ping` / `curl` 测试）
- [ ] MT5 已将中继服务 URL 加入白名单（工具 → 选项 → Expert Advisors）
- [ ] Telegram 机器人已添加到目标群组

## 消息格式

| 场景 | 通知 |
|------|------|
| 开仓 | 🟢 開倉 Open Position |
| 部分平仓 | 💵 收走部分利潤 Partial TP |
| 全部平仓 + 盈利 | 💰 止盈出場 Take Profit |
| 全部平仓 + 亏损 | 📉 止損出場 Stop Loss |
| 止损低于入场价 | 🛡️ 修改止損 SL Updated |
| 止损在入场价以上 (BUY) | 🆙 保護推上 Breakeven+ |
| 修改止盈 | 🎯 修改止盈 TP Updated |
| 止损触发 | 🚨 止損觸發 SL Triggered |
| 止盈触发 | 🏆 止盈觸發 TP Triggered |

## 开发

```bash
cd relay

npm run dev          # 开发服务器（热重载）
npm test             # 运行测试
npm run test:watch   # 监听模式
npx tsc --noEmit     # 仅类型检查
```

## 故障排除

| 问题 | 解决方式 |
|------|---------|
| `curl localhost:3000/health` 失败 | 中继服务未启动 — 检查 `pm2 status` 或用 `npm run dev` 启动 |
| EA 日志显示 "WebRequest failed" | 将中继服务 URL 添加到 MT5 允许列表（工具 → 选项 → Expert Advisors） |
| EA 日志显示 "URL not configured" | 检查 EA 输入参数 `InpRelayURL` 是否已设置 |
| 没收到 Telegram 消息 | 确认 `.env` 中的 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_CHAT_ID`；确认机器人在群组中 |
| 重复消息 | 正常运作 — 去重服务会通过 SQLite 过滤 |
| EA 日志乱码 | 日志为 UTF-16LE 编码：`iconv -f UTF-16LE -t UTF-8 <日志文件>` |
