export function ensureRoleManagementChat(ctx: any, deps: any): boolean {
  const chatId = ctx.chat?.id;
  if (!chatId) return false;

  const uow = deps.uow as any;
  const cfg = uow.chatSettings?.getSnapshot?.();

  if (!cfg || !cfg.roleMgmtChatId) {
    // اگر اصلاً تنظیم نشده، فعلاً آزاد است
    return true;
  }

  return Number(cfg.roleMgmtChatId) === Number(chatId);
}
