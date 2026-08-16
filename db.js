const Database = require('better-sqlite3');
const path = require('path');

// Initialize SQLite database
const dbPath = path.join(__dirname, 'bot_database.sqlite');
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
      validity TEXT NOT NULL,
      key_string TEXT UNIQUE NOT NULL,
      is_used BOOLEAN DEFAULT 0,
      claimed_by TEXT
    );
  `);
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

function addBulkKeys(validity, keyArray) {
  const stmt = db.prepare('INSERT OR IGNORE INTO bulk_keys (validity, key_string) VALUES (?, ?)');
  const insertMany = db.transaction((keys) => {
    let count = 0;
    for (const key of keys) {
      const result = stmt.run(validity, key);
      if (result.changes > 0) count++;
    }
    return count;
  });
  return insertMany(keyArray);
}

function getInventoryStock() {
  const stmt = db.prepare('SELECT validity, COUNT(*) as count FROM bulk_keys WHERE is_used = 0 GROUP BY validity');
  const rows = stmt.all();
  const stock = {};
  for (const row of rows) {
    stock[row.validity] = row.count;
  }
  return stock;
}

function dispenseKey(validity, userId) {
  // We need to fetch an unused key and mark it used in a transaction to avoid race conditions
  const dispenseTransaction = db.transaction(() => {
    const fetchStmt = db.prepare('SELECT key_string FROM bulk_keys WHERE validity = ? AND is_used = 0 LIMIT 1');
    const keyRow = fetchStmt.get(validity);
    
    if (!keyRow) return null;
    
    const updateStmt = db.prepare('UPDATE bulk_keys SET is_used = 1, claimed_by = ? WHERE key_string = ?');
    updateStmt.run(userId.toString(), keyRow.key_string);
    
    return keyRow.key_string;
  });
  
  return dispenseTransaction();
}

module.exports = {
  addAuthorizedUser,
  isUserAuthorized,
  canUserClaimToday,
  incrementUserClaim,
  addBulkKeys,
  getInventoryStock,
  dispenseKey
};
