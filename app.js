const TeleBot = require('telebot');
const config = require('./config.js').config;

console.log('config', config);
const bot = new TeleBot({
    token: config.BOT_TOKEN, // Required. Telegram Bot API token.
});

bot.on(['/start', '/hello'], (msg) => msg.reply.text('Welcome!'));

bot.start();