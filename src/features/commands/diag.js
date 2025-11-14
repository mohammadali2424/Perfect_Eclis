// src/features/commands/diag.js
function redact(s='') {
  return String(s).replace(/(bot)\d{5,}:[A-Za-z0-9_-]{20,}/g, '$1***:***');
}

function register(bot) {
  bot.command('diag', async (ctx) => {
    try {
      const info = await bot.telegram.getWebhookInfo();
      const me = await bot.telegram.getMe();
      const lines = [
        `🤖 ${me.username} (id=${me.id})`,
        `Webhook URL: ${info.url || '-'}`,
        `Pending updates: ${info.pending_update_count}`,
        `Has cert: ${info.has_custom_certificate ? 'yes' : 'no'}`,
        info.last_error_date ? `Last error at: ${new Date(info.last_error_date*1000).toISOString()}` : '',
        info.last_error_message ? `Last error: ${info.last_error_message}` : '',
      ].filter(Boolean);
      await ctx.reply(lines.join('\n'));
    } catch (e) {
      await ctx.reply('diag failed: ' + redact(e?.message || String(e)));
    }
  });
}

module.exports = { register };
