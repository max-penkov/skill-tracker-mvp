require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbFolder = process.env.RENDER ? '/var/data' : './';
if (process.env.RENDER && !fs.existsSync(dbFolder)) {
  fs.mkdirSync(dbFolder, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dbFolder, 'database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Ошибка подключения к SQLite:', err);
  else console.log(`Успешное подключение к SQLite (${dbPath})`);
});

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

// Интерфейс, совместимый с pg: query(sql, params) => { rows }
// SQLite понимает RETURNING, поэтому INSERT/UPDATE возвращают строки
const query = async (text, params = []) => {
  const trimmed = text.trimStart().toUpperCase();
  if (trimmed.startsWith('SELECT') || text.includes('RETURNING')) {
    const rows = await all(text, params);
    return { rows };
  }
  const { lastID, changes } = await run(text, params);
  return { rows: [], lastID, changes };
};

const initSchema = async () => {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      target_hours INTEGER DEFAULT 20,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      is_completed INTEGER DEFAULT 0,
      order_index INTEGER DEFAULT 0,
      FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS practice_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id INTEGER NOT NULL UNIQUE,
      skill_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      stage INTEGER DEFAULT 1,
      next_review_at DATE NOT NULL,
      last_reviewed_at DATE,
      FOREIGN KEY(module_id) REFERENCES modules(id) ON DELETE CASCADE
    )
  `);
  console.log('Схема БД инициализирована');
};

module.exports = { db, query, run, get, all, initSchema };
