export type XpReason = string;

export type XpEntry = {
  id: string;
  chatId: number;
  userId: number;
  delta: number;
  reason: XpReason;
  createdAt: string; // ISO
};
