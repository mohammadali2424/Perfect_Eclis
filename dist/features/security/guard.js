"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSecurityFeature = registerSecurityFeature;
const config_1 = require("../../core/config");
function registerSecurityFeature(bot) {
    bot.on("my_chat_member", async (ctx) => {
        const update = ctx.myChatMember;
        const chat = update.chat;
        const newStatus = update.new_chat_member.status;
        const from = update.from;
        if (!chat || chat.type === "private")
            return;
        if (newStatus === "member" || newStatus === "administrator") {
            if (!from || from.id !== config_1.MASTER_ID) {
                try {
                    await ctx.api.sendMessage(chat.id, "این ربات متعلق به مجموعه اکلیس است و فقط اربابم حق فعال کردن من را دارد، حدت را بدان.");
                }
                catch (e) {
                    console.error("sendMessage before leaveChat failed:", e);
                }
                try {
                    await ctx.api.leaveChat(chat.id);
                }
                catch (e) {
                    console.error("leaveChat failed:", e);
                }
            }
        }
    });
    bot.command(["start", "help"], async (ctx, next) => {
        var _a;
        if (!ctx.from)
            return next();
        if (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) !== "private" && ctx.from.id !== config_1.MASTER_ID) {
            await ctx.reply("🥷🏻 فقط ارباب من میتوته بهم دستور بده ، حدتو بدون");
            return;
        }
        return next();
    });
}
