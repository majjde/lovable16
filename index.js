require('dotenv').config();
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// We now use SQLite (db.js) for valid keys and active sessions to persist across deployments.

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

  // Verify the key is in our valid keys DB
  const keyData = db.getValidKey(license_key);
  if (!keyData) {
    return res.status(400).json({
      valid: false,
      status: 'invalid',
      message: 'License not found or invalid key!'
    });
  }

  const activeSessionId = session_id || 'sess_' + crypto.randomBytes(12).toString('hex');
  const now = new Date();
  const expiresAt = new Date(keyData.expires_at).toISOString();

  db.addActiveSession(activeSessionId, license_key || 'LOVE-FREEFLOW-KEY', device_id, now.toISOString(), expiresAt);

  return res.json({
    // Old extension format
    valid: true,
    status: 'valid',
    message: 'License activated successfully!',
    user_name: 'Lovable Unlimited',
    session_id: activeSessionId,
    expires_at: expiresAt,
    activated_at: now.toISOString(),
    
    // New extension format
    ok: true,
    license_id: 'lic_' + crypto.randomBytes(8).toString('hex'),
    email: 'user@lovable.app',
    license: {
      expires_at: expiresAt,
      created_at: now.toISOString(),
      plan: 'premium',
      status: 'active',
      bound_email: 'user@lovable.app'
    }
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

// Stub endpoints for extension features (bypassing eklas proxy)
app.post('/api/v1/lovable/session', (req, res) => res.json({ ok: true }));
app.post('/api/v1/lovable/chat', (req, res) => res.json({ ok: true }));
app.post('/api/v1/lovable/approve-plan', (req, res) => res.json({ ok: true }));
app.post('/api/v1/lovable/create-project', (req, res) => res.json({ ok: true }));
app.post('/api/v1/lovable/source-code', (req, res) => res.json({ ok: true }));

// Start Express HTTP Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 LOVABLE License API Server running on port ${PORT}`);
});

// Optional Telegram Bot Initialization
const token = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (token && token !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
  try {
    const bot = new TelegramBot(token, { polling: true });
    console.log('🤖 LOVABLE Telegram License Bot is running...');

    const adminStates = new Map();

    function checkAuth(ctxFromId, chatId) {
      if (chatId.toString() === ADMIN_CHAT_ID) return true;
      const auth = db.isUserAuthorized(ctxFromId);
      return auth.isAuthorized;
    }

    function sendAccessDenied(chatId) {
      bot.sendMessage(chatId, "⛔ <b>Access Denied</b>\n\nYou are not authorized to use this bot. Please contact the administrator for access.", { parse_mode: 'HTML' });
    }

    // --- UI MENU HELPERS ---
    function getAdminMenu(chatId) {
      return {
        text: '⚙️ *Admin Dashboard*\n\nSelect an option below:',
        options: {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '👥 Set Authorized User', callback_data: 'admin_add_user' }],
              [{ text: '🧩 Extensions', callback_data: 'admin_extensions_menu' }]
            ]
          }
        }
      };
    }

    function getUserMenu() {
      return {
        text: '✨ *Welcome to LOVABLE License Generator*\n\nPlease select an option below:',
        options: {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📂 Existing Extensions', callback_data: 'user_extensions_menu' }]
            ]
          }
        }
      };
    }

    function getExtensionsMenu() {
      return {
        text: '🧩 *Extensions Management*\n\nSelect an option below:',
        options: {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Add Extension', callback_data: 'admin_add_ext' }],
              [{ text: '📂 Existing Extensions', callback_data: 'admin_list_ext' }],
              [{ text: '🔙 Back', callback_data: 'main_menu' }]
            ]
          }
        }
      };
    }

    function getExistingExtensionsMenu(isAdmin) {
      const exts = db.getExtensions();
      const keyboard = [];
      for (const ext of exts) {
        keyboard.push([{ text: `📁 ${ext}`, callback_data: `select_ext:${ext}` }]);
      }
      keyboard.push([{ text: '🔙 Back', callback_data: isAdmin ? 'admin_extensions_menu' : 'main_menu' }]);
      
      return {
        text: '📂 *Existing Extensions*\n\nSelect an extension to proceed:',
        options: {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        }
      };
    }

    function getDurationMenu(extName, isAdmin) {
      const stock = db.getInventoryStock(extName);
      
      const getBtnText = (validity) => {
        if (isAdmin) return `[${validity}]`;
        const count = stock[validity] || 0;
        return `${validity} (${count} in stock)`;
      };

      const keyboard = [
        [ 
          { text: getBtnText('20m'), callback_data: `dur:${extName}:20m` },
          { text: getBtnText('1d'), callback_data: `dur:${extName}:1d` },
          { text: getBtnText('3d'), callback_data: `dur:${extName}:3d` }
        ],
        [
          { text: getBtnText('7d'), callback_data: `dur:${extName}:7d` },
          { text: getBtnText('14d'), callback_data: `dur:${extName}:14d` },
          { text: getBtnText('30d'), callback_data: `dur:${extName}:30d` }
        ],
        [ { text: '🔙 Back', callback_data: isAdmin ? 'admin_list_ext' : 'user_extensions_menu' } ]
      ];

      const text = isAdmin 
        ? `📁 *${extName}*\n\nSelect a duration to bulk upload keys:` 
        : `📁 *${extName}*\n\nSelect a duration to generate a license key:`;

      return {
        text,
        options: {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        }
      };
    }
    // --- END UI MENU HELPERS ---

    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      if (!checkAuth(msg.from.id, chatId)) {
        return sendAccessDenied(chatId);
      }
      adminStates.delete(chatId);
      const isAdmin = chatId.toString() === ADMIN_CHAT_ID;
      const menu = isAdmin ? getAdminMenu(chatId) : getUserMenu();
      bot.sendMessage(chatId, menu.text, menu.options);
    });

    bot.on('message', (msg) => {
      if (msg.text && msg.text.startsWith('/start')) return;

      const chatId = msg.chat.id;
      if (!checkAuth(msg.from.id, chatId)) {
        if (!msg.text?.startsWith('/')) sendAccessDenied(chatId);
        return;
      }

      const text = msg.text;
      
      if (chatId.toString() === ADMIN_CHAT_ID && adminStates.has(chatId)) {
        const state = adminStates.get(chatId);
        
        if (state.action === 'AWAITING_USER_ADD') {
          const parts = text.split(',');
          if (parts.length === 2) {
            const userId = parts[0].trim();
            const maxKeys = parseInt(parts[1].trim(), 10);
            if (!isNaN(maxKeys)) {
              db.addAuthorizedUser(userId, maxKeys);
              bot.sendMessage(chatId, `✅ Successfully authorized user ${userId} for ${maxKeys} keys/day.`);
            } else {
              bot.sendMessage(chatId, '❌ Invalid format. Please send: UserID, MaxKeys');
            }
          } else {
            bot.sendMessage(chatId, '❌ Invalid format. Please send: UserID, MaxKeys');
          }
          adminStates.delete(chatId);
          const menu = getAdminMenu(chatId);
          bot.sendMessage(chatId, menu.text, menu.options);
          return;
        } 
        
        if (state.action === 'AWAITING_EXT_ADD') {
          if (text) {
             db.addExtension(text.trim());
             bot.sendMessage(chatId, `✅ Successfully created extension: *${text.trim()}*`, { parse_mode: 'Markdown' });
             const menu = getExtensionsMenu();
             bot.sendMessage(chatId, menu.text, menu.options);
          }
          adminStates.delete(chatId);
          return;
        }

        if (state.action === 'AWAITING_BULK_KEYS') {
          const keys = text.split(/[\n,]+/).map(k => k.trim()).filter(k => k.length > 0);
          if (keys.length > 0) {
            const added = db.addBulkKeys(state.extName, state.validity, keys);
            bot.sendMessage(chatId, `✅ Successfully added ${added} keys to *${state.extName}* (${state.validity}).`, { parse_mode: 'Markdown' });
          } else {
            bot.sendMessage(chatId, '❌ No valid keys found.');
          }
          adminStates.delete(chatId);
          const menu = getDurationMenu(state.extName, true);
          bot.sendMessage(chatId, menu.text, menu.options);
          return;
        }
      }
    });

    bot.on('callback_query', (query) => {
      const chatId = query.message.chat.id;
      const messageId = query.message.message_id;
      const data = query.data;
      const isAdmin = chatId.toString() === ADMIN_CHAT_ID;

      if (!checkAuth(query.from.id, chatId)) {
        bot.answerCallbackQuery(query.id, { text: "⛔ Access Denied", show_alert: true });
        return;
      }

      const editMessage = (menu) => {
        bot.editMessageText(menu.text, {
          chat_id: chatId,
          message_id: messageId,
          ...menu.options
        }).catch(err => {
          // Ignore "message is not modified" errors
          if (!err.response?.body?.description.includes('exactly the same')) {
            console.error(err);
          }
        });
        bot.answerCallbackQuery(query.id);
      };

      if (data === 'main_menu') {
        adminStates.delete(chatId);
        editMessage(isAdmin ? getAdminMenu(chatId) : getUserMenu());
        return;
      }

      if (data === 'admin_add_user' && isAdmin) {
        adminStates.set(chatId, { action: 'AWAITING_USER_ADD' });
        bot.sendMessage(chatId, 'Send the user ID and daily limit separated by a comma.\nExample: 123456789, 5');
        bot.answerCallbackQuery(query.id);
        return;
      }

      if (data === 'admin_extensions_menu' && isAdmin) {
        editMessage(getExtensionsMenu());
        return;
      }

      if (data === 'admin_add_ext' && isAdmin) {
        adminStates.set(chatId, { action: 'AWAITING_EXT_ADD' });
        bot.sendMessage(chatId, 'Please send the name of the new extension:');
        bot.answerCallbackQuery(query.id);
        return;
      }

      if ((data === 'admin_list_ext' || data === 'user_extensions_menu')) {
        if (data === 'admin_list_ext' && !isAdmin) return bot.answerCallbackQuery(query.id);
        editMessage(getExistingExtensionsMenu(isAdmin));
        return;
      }

      if (data.startsWith('select_ext:')) {
        const extName = data.split(':')[1];
        editMessage(getDurationMenu(extName, isAdmin));
        return;
      }

      if (data.startsWith('dur:')) {
        const parts = data.split(':');
        const extName = parts[1];
        const validity = parts[2];
        
        if (isAdmin) {
          adminStates.set(chatId, { action: 'AWAITING_BULK_KEYS', extName, validity });
          bot.sendMessage(chatId, `Please paste the keys for *${extName}* (${validity} validity) separated by commas or newlines.`, { parse_mode: 'Markdown' });
          bot.answerCallbackQuery(query.id);
        } else {
          // User claiming key
          if (!db.canUserClaimToday(query.from.id)) {
            bot.answerCallbackQuery(query.id, { text: "🛑 Daily Limit Reached! Try again tomorrow.", show_alert: true });
            return;
          }

          const keyString = db.dispenseKey(extName, validity, query.from.id);
          if (!keyString) {
             bot.answerCallbackQuery(query.id, { text: "❌ Out of stock for this duration.", show_alert: true });
             editMessage(getDurationMenu(extName, isAdmin)); // Refresh stock numbers
             return;
          }

          db.incrementUserClaim(query.from.id);
          
          bot.sendMessage(chatId, `🎉 *Key Generated Successfully!*\n\n*Extension:* ${extName}\n*Validity:* ${validity}\n*License Key:* \`${keyString}\`\n\n_Tap to copy the license key above._`, { parse_mode: 'Markdown' });
          
          editMessage(getDurationMenu(extName, isAdmin)); // Refresh stock numbers
        }
        return;
      }
      
      bot.answerCallbackQuery(query.id);
    });
  } catch (err) {
    console.error('Failed to start Telegram Bot:', err.message);
  }
} else {
  console.log('ℹ️ BOT_TOKEN not set or default. Running HTTP API server only.');
}

module.exports = {
  generateLicenseKey,
  getExpiryDate
};
