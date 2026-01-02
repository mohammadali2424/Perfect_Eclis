export type ChatId = number;
export type UserId = number;

export type CommandContext = {
  chatId: ChatId;
  userId: UserId;
  text: string;
  args: string[];
};

export interface Command {
  /** primary name in Persian, e.g. "ایکسپی" */
  name: string;
  aliases?: string[];
  description: string;
  execute(ctx: CommandContext): Promise<string | void>;
}
