import { runBot } from "./core/bot";
import express from "express";
import { config } from "./core/config";

const app = express();

app.get("/", (req, res) => {
  res.send("Eclis Bot is running.");
});

// برای رندر لازم است که پورت فعال باشد
app.listen(config.PORT, () => {
  console.log("Express server ready.");
});

// اجرای خود ربات
runBot();
