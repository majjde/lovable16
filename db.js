const Database = require('better-sqlite3');
const path = require('path');

// Initialize SQLite database
// Use DATA_DIR from environment variables for persistent storage (e.g. Railway Volumes)
const dbDir = process.env.DATA_DIR || __dirname;
const dbPath = path.join(dbDir, 'bot_database.sqlite');
const db = new Database(dbPath);

// Initialize Schema
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authorized_users (
      user_id TEXT UNIQUE PRIMARY KEY,
      max_daily_keys INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_claims (
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      claimed_count INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, date),
      FOREIGN KEY (user_id) REFERENCES authorized_users(user_id)
    );

    CREATE TABLE IF NOT EXISTS bulk_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      extension_name TEXT NOT NULL DEFAULT 'Extension 1',
      validity TEXT NOT NULL,
      key_string TEXT UNIQUE NOT NULL,
      is_used BOOLEAN DEFAULT 0,
      claimed_by TEXT
    );

    CREATE TABLE IF NOT EXISTS extensions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS valid_keys (
      license_key TEXT PRIMARY KEY,
      duration INTEGER,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS active_sessions (
      session_id TEXT PRIMARY KEY,
      license_key TEXT,
      device_id TEXT,
      activated_at TEXT,
      expires_at TEXT
    );
  `);
  
  // Whitelist the real key for proxy features
  db.exec(`
    INSERT OR IGNORE INTO valid_keys (license_key, duration, expires_at) 
    VALUES ('LOVABLE-Q9E8-H6AV-EEVV-GAXJ', 365, '${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()}');
  `);

  // Handle schema migration for existing databases and setup default extension
  try { db.exec("ALTER TABLE bulk_keys ADD COLUMN extension_name TEXT NOT NULL DEFAULT 'Extension 1'"); } catch (e) {}
  db.exec("INSERT OR IGNORE INTO extensions (name) VALUES ('Extension 1')");
}

initDb();

function addAuthorizedUser(userId, maxKeys) {
  const stmt = db.prepare(`
    INSERT INTO authorized_users (user_id, max_daily_keys) 
    VALUES (?, ?) 
    ON CONFLICT(user_id) DO UPDATE SET max_daily_keys = excluded.max_daily_keys
  `);
  stmt.run(userId.toString(), maxKeys);
}

function isUserAuthorized(userId) {
  const stmt = db.prepare('SELECT max_daily_keys FROM authorized_users WHERE user_id = ?');
  const user = stmt.get(userId.toString());
  if (user) {
    return { isAuthorized: true, maxKeys: user.max_daily_keys };
  }
  return { isAuthorized: false, maxKeys: 0 };
}

function getAuthorizedUsers() {
  const stmt = db.prepare('SELECT user_id, max_daily_keys FROM authorized_users ORDER BY created_at DESC');
  return stmt.all();
}

function revokeUser(userId) {
  const stmt = db.prepare('DELETE FROM authorized_users WHERE user_id = ?');
  stmt.run(userId.toString());
}

function getTodayString() {
  const date = new Date();
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

function canUserClaimToday(userId) {
  const auth = isUserAuthorized(userId);
  if (!auth.isAuthorized) return false;

  const today = getTodayString();
  const stmt = db.prepare('SELECT claimed_count FROM daily_claims WHERE user_id = ? AND date = ?');
  const claim = stmt.get(userId.toString(), today);
  
  const currentCount = claim ? claim.claimed_count : 0;
  return currentCount < auth.maxKeys;
}

function incrementUserClaim(userId) {
  const today = getTodayString();
  const stmt = db.prepare(`
    INSERT INTO daily_claims (user_id, date, claimed_count)
    VALUES (?, ?, 1)
    ON CONFLICT(user_id, date) DO UPDATE SET claimed_count = claimed_count + 1
  `);
  stmt.run(userId.toString(), today);
}

function addExtension(name) {
  const stmt = db.prepare('INSERT OR IGNORE INTO extensions (name) VALUES (?)');
  stmt.run(name);
}

function getExtensions() {
  const stmt = db.prepare('SELECT name FROM extensions ORDER BY id ASC');
  return stmt.all().map(row => row.name);
}

function addBulkKeys(extensionName, validity, keyArray) {
  const stmt = db.prepare('INSERT OR IGNORE INTO bulk_keys (extension_name, validity, key_string) VALUES (?, ?, ?)');
  const insertMany = db.transaction((keys) => {
    let count = 0;
    for (const key of keys) {
      const result = stmt.run(extensionName, validity, key);
      if (result.changes > 0) count++;
    }
    return count;
  });
  return insertMany(keyArray);
}

function getInventoryStock(extensionName) {
  const stmt = db.prepare('SELECT validity, COUNT(*) as count FROM bulk_keys WHERE extension_name = ? AND is_used = 0 GROUP BY validity');
  const rows = stmt.all(extensionName);
  const stock = {};
  for (const row of rows) {
    stock[row.validity] = row.count;
  }
  return stock;
}

function dispenseKey(extensionName, validity, userId) {
  // We need to fetch an unused key and mark it used in a transaction to avoid race conditions
  const dispenseTransaction = db.transaction(() => {
    const fetchStmt = db.prepare('SELECT key_string FROM bulk_keys WHERE extension_name = ? AND validity = ? AND is_used = 0 LIMIT 1');
    const keyRow = fetchStmt.get(extensionName, validity);
    
    if (!keyRow) return null;
    
    const updateStmt = db.prepare('UPDATE bulk_keys SET is_used = 1, claimed_by = ? WHERE key_string = ?');
    updateStmt.run(userId.toString(), keyRow.key_string);
    
    return keyRow.key_string;
  });
  
  return dispenseTransaction();
}

function getValidKey(licenseKey) {
  if (!licenseKey) return null;
  const stmt = db.prepare('SELECT * FROM valid_keys WHERE license_key = ?');
  return stmt.get(licenseKey.toString());
}

function addValidKey(licenseKey, duration, expiresAt) {
  const stmt = db.prepare(`
    INSERT INTO valid_keys (license_key, duration, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(license_key) DO UPDATE SET duration = excluded.duration, expires_at = excluded.expires_at
  `);
  stmt.run(licenseKey.toString(), duration || 0, expiresAt.toString());
}

function getActiveSession(sessionId) {
  if (!sessionId) return null;
  const stmt = db.prepare('SELECT * FROM active_sessions WHERE session_id = ?');
  return stmt.get(sessionId.toString());
}

function addActiveSession(sessionId, licenseKey, deviceId, activatedAt, expiresAt) {
  const stmt = db.prepare(`
    INSERT INTO active_sessions (session_id, license_key, device_id, activated_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET 
      license_key = excluded.license_key,
      device_id = excluded.device_id,
      activated_at = excluded.activated_at,
      expires_at = excluded.expires_at
  `);
  stmt.run(sessionId.toString(), licenseKey.toString(), deviceId.toString(), activatedAt.toString(), expiresAt.toString());
}

module.exports = {
  addAuthorizedUser,
  isUserAuthorized,
  getAuthorizedUsers,
  revokeUser,
  canUserClaimToday,
  incrementUserClaim,
  addExtension,
  getExtensions,
  addBulkKeys,
  getInventoryStock,
  dispenseKey,
  getValidKey,
  addValidKey,
  getActiveSession,
  addActiveSession
};
