import type { ChatSettingsKey, ChatSettingsSnapshot } from "./types.js";

export interface ChatSettingsRepo {
  getSnapshot(): Promise<ChatSettingsSnapshot>;
  set(key: ChatSettingsKey, value: number | null): Promise<void>;
}
