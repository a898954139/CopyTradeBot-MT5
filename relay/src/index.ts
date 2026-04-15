import { loadConfig } from "./config.js";
import { getDb } from "./db/database.js";
import { createApp } from "./app.js";
import { TelegramService } from "./services/telegram.js";

function main(): void {
  const config = loadConfig();
  const db = getDb(config.dbPath);
  const telegram = new TelegramService(
    config.telegramBotToken,
    config.telegramChatId,
  );

  const app = createApp({ db, webhookSecret: config.webhookSecret, telegram });

  app.listen(config.port, () => {
    console.log(`[Relay] Listening on port ${config.port}`);
  });
}

main();
