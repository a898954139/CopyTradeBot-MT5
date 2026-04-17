import TelegramBot from "node-telegram-bot-api";

export class TelegramService {
  private readonly bot: TelegramBot;
  private readonly chatId: string;

  constructor(token: string, chatId: string) {
    this.bot = new TelegramBot(token, { polling: false });
    this.chatId = chatId;
  }

  async sendMessage(text: string): Promise<string> {
    const result = await this.bot.sendMessage(this.chatId, text, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    return String(result.message_id);
  }

  async editMessage(messageId: string, text: string): Promise<void> {
    await this.bot.editMessageText(text, {
      chat_id: this.chatId,
      message_id: Number(messageId),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }
}

/** Stub for testing — records sent messages without hitting Telegram */
export class StubTelegramService extends TelegramService {
  readonly sentMessages: string[] = [];
  readonly editedMessages: { messageId: string; text: string }[] = [];
  private counter = 1;

  constructor() {
    // Pass dummy values — we override sendMessage
    super("dummy", "dummy");
  }

  override async sendMessage(text: string): Promise<string> {
    this.sentMessages.push(text);
    return String(this.counter++);
  }

  override async editMessage(messageId: string, text: string): Promise<void> {
    this.editedMessages.push({ messageId, text });
    const idx = Number(messageId) - 1;
    if (idx >= 0 && idx < this.sentMessages.length) {
      this.sentMessages[idx] = text;
    }
  }
}
