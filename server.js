const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const APP = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'mvp_secret_key_123';

// --- MIDDLEWARES ---
APP.use(cors());
APP.use(express.json());

// --- БАЗА ДАННЫХ SQLITE ---
// Создаем директорию для БД, если ее нет (на Render используем монтируемый диск)
const dbFolder = process.env.RENDER ? '/var/data' : './';
if (process.env.RENDER && !fs.existsSync(dbFolder)) {
  fs.mkdirSync(dbFolder, { recursive: true });
}

const dbPath = path.join(dbFolder, 'database.sqlite');
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) console.error('Ошибка подключения к SQLite:', err);
  else console.log('Успешное подключение к SQLite (database.sqlite)');
});

// Инициализация таблиц
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  db.run(`
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

  db.run(`
    CREATE TABLE IF NOT EXISTS modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      is_completed INTEGER DEFAULT 0,
      order_index INTEGER DEFAULT 0,
      FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
    )
  `);
});

// --- AUTH MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Токен отсутствует' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Недействительный токен' });
    req.user = user;
    next();
  });
};

// --- ROUTES: АВТОРИЗАЦИЯ ---

// Регистрация
APP.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Заполните email и пароль' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const sql = `INSERT INTO users (email, password) VALUES (?, ?)`;

  db.run(sql, [email, hashedPassword], function (err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ error: 'Пользователь уже существует' });
      }
      return res.status(500).json({ error: err.message });
    }

    const token = jwt.sign({ id: this.lastID, email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: this.lastID, email } });
  });
});

// Вход
APP.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const sql = `SELECT * FROM users WHERE email = ?`;

  db.get(sql, [email], async (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(400).json({ error: 'Пользователь не найден' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Неверный пароль' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email } });
  });
});

// --- ROUTES: НАВЫКИ ---

// Получение списка навыков пользователя со статистикой
APP.get('/api/skills', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const sqlSkills = `SELECT * FROM skills WHERE user_id = ? ORDER BY created_at DESC`;

  db.all(sqlSkills, [userId], (err, skills) => {
    if (err) return res.status(500).json({ error: err.message });

    if (skills.length === 0) return res.json([]);

    let completedQueries = 0;
    const result = [];

    skills.forEach((skill) => {
      const sqlModules = `SELECT id, title, is_completed, order_index FROM modules WHERE skill_id = ? ORDER BY order_index`;
      const sqlSessions = `SELECT SUM(duration_minutes) as total_practiced FROM sessions WHERE skill_id = ?`;

      db.all(sqlModules, [skill.id], (err, modules) => {
        db.get(sqlSessions, [skill.id], (err, sessionRow) => {
          result.push({
            ...skill,
            total_minutes_practiced: sessionRow?.total_practiced || 0,
            modules: modules || [],
          });

          completedQueries++;
          if (completedQueries === skills.length) {
            res.json(result);
          }
        });
      });
    });
  });
});

// Создание навыка с деконструированными модулями
APP.post('/api/skills', authenticateToken, (req, res) => {
  const { title, description, target_hours = 20, modules = [] } = req.body;
  const userId = req.user.id;

  const sqlSkill = `INSERT INTO skills (user_id, title, description, target_hours) VALUES (?, ?, ?, ?)`;

  db.run(sqlSkill, [userId, title, description, target_hours], function (err) {
    if (err) return res.status(500).json({ error: err.message });

    const skillId = this.lastID;

    if (modules.length > 0) {
      const stmt = db.prepare(`INSERT INTO modules (skill_id, title, order_index) VALUES (?, ?, ?)`);
      modules.forEach((mod, idx) => stmt.run(skillId, mod.title, idx + 1));
      stmt.finalize();
    }

    res.status(201).json({
      id: skillId,
      user_id: userId,
      title,
      description,
      target_hours,
      modules,
    });
  });
});

// Переключение состояния модуля
APP.patch('/api/modules/:id', authenticateToken, (req, res) => {
  const { is_completed } = req.body;
  const moduleId = req.params.id;

  const sql = `UPDATE modules SET is_completed = ? WHERE id = ?`;
  db.run(sql, [is_completed ? 1 : 0, moduleId], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: moduleId, is_completed: Boolean(is_completed) });
  });
});

// --- ROUTES: ПРАКТИЧЕСКИЕ СЕССИИ (ТАЙМЕР) ---

// Сохранение сессии практики
APP.post('/api/sessions', authenticateToken, (req, res) => {
  const { skill_id, duration_minutes, notes } = req.body;

  if (!skill_id || !duration_minutes) {
    return res.status(400).json({ error: 'Укажите skill_id и duration_minutes' });
  }

  const sql = `INSERT INTO sessions (skill_id, duration_minutes, notes) VALUES (?, ?, ?)`;
  db.run(sql, [skill_id, duration_minutes, notes || ''], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: this.lastID, skill_id, duration_minutes, notes });
  });
});

// --- ЗАПУСК СЕРВЕРА ---
APP.listen(PORT, () => {
  console.log(`MVP Сервер запущен на http://localhost:${PORT}`);
});
