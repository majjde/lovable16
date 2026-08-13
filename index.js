require('dotenv').config();
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory activated sessions store
const activeSessions = new Map();

// Helper: Generate 12-character formatted key: LOVE-XXXX-XXXX
function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randomPart = '';
  for (let i = 0; i < 8; i++) {
    const randomIndex = crypto.randomInt(0, chars.length);
    randomPart += chars[randomIndex];
  }
  return `LOVE-${randomPart.slice(0, 4)}-${randomPart.slice(4, 8)}`;
}

// Helper: Format expiration date
function getExpiryDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + parseInt(days, 10));
  return date.toISOString().split('T')[0];
}

// Validation Handler logic (supports /api/validate, /validate, and root fallback)
function handleValidate(req, res) {
  const body = req.body || {};
  const license_key = body.license_key || body.licenseKey || body.key || body.ql_license_key;
  const device_id = body.device_id || body.deviceId || 'device_default';
  const session_id = body.session_id || body.sessionId;

  console.log(`[Validation Request] Path: ${req.path}, Key: "${license_key}", Device: "${device_id}", Session: "${session_id}"`);

  const activeSessionId = session_id || 'sess_' + crypto.randomBytes(12).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year validity

  activeSessions.set(activeSessionId, {
    license_key: license_key || 'LOVE-FREEFLOW-KEY',
    device_id: device_id,
    activated_at: now.toISOString(),
    expires_at: expiresAt
  });

  return res.json({
    valid: true,
    status: 'valid',
    message: 'License activated successfully!',
    user_name: 'Lovable Unlimited',
    session_id: activeSessionId,
    expires_at: expiresAt,
    activated_at: now.toISOString()
  });
}

// Register endpoints
app.post('/api/validate', handleValidate);
app.post('/validate', handleValidate);

// Health check endpoint for Railway & monitoring
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'LOVABLE License Backend', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.send('<h1>LOVABLE License Server & API</h1><p>Status: Active | Endpoint: <code>POST /api/validate</code></p>');
});

// Start Express HTTP Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 LOVABLE License API Server running on port ${PORT}`);
});

// Optional Telegram Bot Initialization
const token = process.env.BOT_TOKEN;

if (token && token !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
  try {
    const bot = new TelegramBot(token, { polling: true });
    console.log('🤖 LOVABLE Telegram License Bot is running...');

    bot.onText(/\/start/, (msg) => {
      sendDurationPrompt(bot, msg.chat.id);
    });

    bot.on('message', (msg) => {
      if (msg.text && !msg.text.startsWith('/')) {
        const days = parseInt(msg.text, 10);
        if (!isNaN(days) && days > 0) {
          issueKey(bot, msg.chat.id, days);
        } else {
          sendDurationPrompt(bot, msg.chat.id);
        }
      }
    });

    bot.on('callback_query', (query) => {
      const chatId = query.message.chat.id;
      const data = query.data;

      if (data.startsWith('duration_')) {
        const days = parseInt(data.replace('duration_', ''), 10);
        bot.answerCallbackQuery(query.id);
        issueKey(bot, chatId, days);
      }
    });
  } catch (err) {
    console.error('Failed to start Telegram Bot:', err.message);
  }
} else {
  console.log('ℹ️ BOT_TOKEN not set or default. Running HTTP API server only.');
}

function sendDurationPrompt(bot, chatId) {
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

function issueKey(bot, chatId, days) {
  const licenseKey = generateLicenseKey();
  const expiry = getExpiryDate(days);

  const message = `🔑 *LOVABLE License Key Generated!*\n\n` +
                  `*License Key:* \`${licenseKey}\`\n` +
                  `*Duration:* ${days} Days\n` +
                  `*Expires On:* ${expiry}\n\n` +
                  `_Tap to copy the license key above._`;

  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

module.exports = {
  generateLicenseKey,
  getExpiryDate
};
