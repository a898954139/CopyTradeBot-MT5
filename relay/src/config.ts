import "dotenv/config";

interface Config {
  readonly port: number;
  readonly webhookSecret: string;
  readonly telegramBotToken: string;
  readonly telegramChatId: string;
  readonly dbPath: string;
  readonly followTradingEnabled: boolean;
  readonly followLotSize: number;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env["PORT"] ?? "3000", 10),
    webhookSecret: requireEnv("WEBHOOK_SECRET"),
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    telegramChatId: requireEnv("TELEGRAM_CHAT_ID"),
    dbPath: process.env["DB_PATH"] ?? "./data/relay.db",
    followTradingEnabled: process.env["FOLLOW_TRADING_ENABLED"] === "true",
    followLotSize: parseFloat(process.env["FOLLOW_LOT_SIZE"] ?? "0.01"),
  };
}
