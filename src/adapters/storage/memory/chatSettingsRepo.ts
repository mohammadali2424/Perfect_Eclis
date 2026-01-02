import type { ChatSettingsRepo } from "../../../core/chatSettings/repo.js";
import type { ChatSettingsKey, ChatSettingsSnapshot } from "../../../core/chatSettings/types.js";

export class MemoryChatSettingsRepo implements ChatSettingsRepo {
  private roleMgmtChatId: number | null = null;
  private logChatId: number | null = null;

  async getSnapshot(): Promise<ChatSettingsSnapshot> {
    return {
      roleMgmtChatId: this.roleMgmtChatId,
      logChatId: this.logChatId,
    };
  }

  async set(key: ChatSettingsKey, value: number | null): Promise<void> {
    if (key === "ROLE_MGMT_CHAT_ID") this.roleMgmtChatId = value;
    if (key === "LOG_CHAT_ID") this.logChatId = value;
  }
}
