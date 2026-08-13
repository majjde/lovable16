require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');

// Generate 12-character formatted key: LOVE-XXXX-XXXX
function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randomPart = '';
  for (let i = 0; i < 8; i++) {
    const randomIndex = crypto.randomInt(0, chars.length);
    randomPart += chars[randomIndex];
  }
  return `LOVE-${randomPart.slice(0, 4)}-${randomPart.slice(4, 8)}`;
}

// Format expiration date
function getExpiryDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + parseInt(days, 10));
  return date.toISOString().split('T')[0];
}

const token = process.env.BOT_TOKEN;

if (require.main === module) {
  if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    console.error('ERROR: Please set a valid BOT_TOKEN in your .env file.');
    process.exit(1);
  }

  const bot = new TelegramBot(token, { polling: true });

  console.log('🤖 LOVABLE License Bot is running...');

  // Start command - ask for duration first
  bot.onText(/\/start/, (msg) => {
    sendDurationPrompt(msg.chat.id);
  });

  // Handle messages when user sends text
  bot.on('message', (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
      const days = parseInt(msg.text, 10);
      if (!isNaN(days) && days > 0) {
        issueKey(msg.chat.id, days);
      } else {
        sendDurationPrompt(msg.chat.id);
      }
    }
  });

  // Handle inline keyboard selection
  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data.startsWith('duration_')) {
      const days = parseInt(data.replace('duration_', ''), 10);
      bot.answerCallbackQuery(query.id);
      issueKey(chatId, days);
    }
  });

  function sendDurationPrompt(chatId) {
    const options = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '1 Month (30 Days)', callback_data: 'duration_30' },
            { text: '3 Months (90 Days)', callback_data: 'duration_90' }
          ],
          [
            { text: '6 Months (180 Days)', callback_data: 'duration_180' },
            { text: '1 Year (365 Days)', callback_data: 'duration_365' }
          ]
        ]
      }
    };
    bot.sendMessage(chatId, '✨ *Welcome to LOVABLE License Generator*\n\nPlease select or type the duration (in days) for your license key:', { parse_mode: 'Markdown', ...options });
  }

  function issueKey(chatId, days) {
    const licenseKey = generateLicenseKey();
    const expiry = getExpiryDate(days);

    const message = `🔑 *LOVABLE License Key Generated!*\n\n` +
                    `*License Key:* \`${licenseKey}\`\n` +
                    `*Duration:* ${days} Days\n` +
                    `*Expires On:* ${expiry}\n\n` +
                    `_Tap to copy the license key above._`;

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }
}

module.exports = {
  generateLicenseKey,
  getExpiryDate
};
