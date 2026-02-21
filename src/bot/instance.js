const TelegramBot = require('node-telegram-bot-api');
const { TELEGRAM_TOKEN } = require('../config/env');

// Init telegram bot to be exported and consumed by handlers
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

bot.on('polling_error', (err) => {
    console.error('❌ Polling error:', err.message);
});

module.exports = bot;
