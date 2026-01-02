export type ChatSettingsKey = "ROLE_MGMT_CHAT_ID" | "LOG_CHAT_ID";

export interface ChatSettingsSnapshot {
  roleMgmtChatId: number | null;
  logChatId: number | null;
}
