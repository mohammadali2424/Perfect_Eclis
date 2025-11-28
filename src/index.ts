import { webhookCallback } from "grammy";
import express from "express";
import { bot } from "./core/bot";

const app = express();
const port = process.env.PORT || 3000;

// Webhook endpoint
app.use(express.json());
app.post("/webhook", webhookCallback(bot, "express"));

// For testing
app.get("/", (req, res) => {
  res.send("Eclis Pathweaver Bot Running");
});

app.listen(port, () => {
  console.log(`Bot webhook server running on port ${port}`);
});
