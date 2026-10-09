-- SkillTracker MVP — схема SQLite
-- Применяется автоматически при старте (src/config/db.js, initSchema).
-- Файл нужен для документации и пересоздания БД с нуля:
--   sqlite3 database.sqlite < schema.sql

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  target_hours INTEGER DEFAULT 20, -- правило 20 часов
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  is_completed INTEGER DEFAULT 0,
  order_index INTEGER DEFAULT 0,
  FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS practice_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

-- Интервальные повторения (система Лейтнера: стадии 1..5, интервалы 1-3-7-14-30 дней)
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL UNIQUE,
  skill_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  stage INTEGER DEFAULT 1,
  next_review_at DATE NOT NULL,
  last_reviewed_at DATE,
  FOREIGN KEY(module_id) REFERENCES modules(id) ON DELETE CASCADE
);
