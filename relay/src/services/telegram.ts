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

  async sendPhoto(filePath: string, replyToMessageId?: string): Promise<string> {
    const replyId = replyToMessageId ? Number.parseInt(replyToMessageId, 10) : NaN;
    const result = await this.bot.sendPhoto(this.chatId, filePath, Number.isFinite(replyId)
      ? { reply_to_message_id: replyId }
      : undefined);
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

/** Stub for testing — records sent messages and photos without hitting Telegram */
export class StubTelegramService extends TelegramService {
  readonly sentMessages: string[] = [];
  readonly sentPhotos: string[] = [];
  readonly sentPhotoReplyTo: Array<string | undefined> = [];
  readonly editedMessages: { messageId: string; text: string }[] = [];
  private counter = 1;

  constructor() {
    // Pass dummy values — we override sendMessage/sendPhoto
    super("dummy", "dummy");
  }

  override async sendMessage(text: string): Promise<string> {
    this.sentMessages.push(text);
    return String(this.counter++);
  }

  override async sendPhoto(filePath: string, replyToMessageId?: string): Promise<string> {
    this.sentPhotos.push(filePath);
    this.sentPhotoReplyTo.push(replyToMessageId);
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
