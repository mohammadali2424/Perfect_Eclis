"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const grammy_1 = require("grammy");
const bot_1 = require("./core/bot");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// برای اینکه تلگرام بتونه JSON بفرسته
app.use(express_1.default.json());
// تست ساده که ببینی سرویس بالا اومده
app.get("/", (_req, res) => {
    res.send("Pathweaver is alive ✨");
});
bot_1.bot.catch((err) => {
    console.error("BOT ERROR:", err.error);
});
// وبهوک اصلی تلگرام
app.post("/webhook", (0, grammy_1.webhookCallback)(bot_1.bot, "express"));
// استارت سرور
app.listen(PORT, () => {
    console.log(`Bot server listening on port ${PORT}`);
});
