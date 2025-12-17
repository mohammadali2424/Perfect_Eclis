// src/core/screen.ts
import { InlineKeyboard } from "grammy";
import crypto from "node:crypto";
import type { MyContext } from "./types";
import { outbox, chatKindFromType } from "./outbox";

export type ScreenMode = "replace"; // future: "edit" | "replace"

/**
 * ScreenManager (PV-first):
 * - In private chats: deletes previous screen message (if we have it) then sends a new one
 * - In groups: just replies (no delete/edit)
 *
 * This keeps UI consistent across features and prevents "double screen systems".
 */
export async function showScreen(
  ctx: MyContext,
  text: string,
  keyboard?: InlineKeyboard,
  _mode: ScreenMode = "replace"
): Promise<void> {
  const kind = chatKindFromType(ctx.chat?.type);

  // De-dupe: if exact same screen was shown recently, do nothing.
  const kbJson = keyboard ? JSON.stringify((keyboard as any).inline_keyboard ?? null) : "";
  const hash = crypto.createHash("sha1").update(text + "\n" + kbJson).digest("hex");
  if (ctx.session.ui_last_hash === hash) return;
  ctx.session.ui_last_hash = hash;

  if (ctx.chat?.type !== "private") {
    outbox.enqueue({
      chatId: ctx.chat!.id,
      kind,
      run: () => ctx.reply(text, { reply_markup: keyboard }),
    });
    return;
  }

  const lastId = ctx.session.ui_last_message_id;
  if (lastId) {
    outbox.enqueue({
      chatId: ctx.chat.id,
      kind,
      run: () => ctx.api.deleteMessage(ctx.chat!.id, lastId),
    });
  }

  outbox.enqueue({
    chatId: ctx.chat.id,
    kind,
    run: async () => {
      const msg = await ctx.reply(text, { reply_markup: keyboard });
      ctx.session.ui_last_message_id = msg.message_id;
    },
  });
}
