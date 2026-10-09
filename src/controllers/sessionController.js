const db = require('../config/db');

// Запись проведенной тренировки (таймера)
exports.logSession = async (req, res) => {
  const { skill_id, duration_minutes, notes } = req.body;
  const userId = req.user.id;

  if (!skill_id || !duration_minutes) {
    return res.status(400).json({ message: 'Укажите ID навыка и длительность' });
  }

  const duration = Number(duration_minutes);
  if (!Number.isInteger(duration) || duration < 1 || duration > 480) {
    return res.status(400).json({ message: 'Длительность должна быть от 1 до 480 минут' });
  }

  try {
    // Проверка владельца навыка
    const { rows: skillRows } = await db.query(
      'SELECT id FROM skills WHERE id = ? AND user_id = ?',
      [skill_id, userId]
    );
    if (skillRows.length === 0) {
      return res.status(404).json({ message: 'Навык не найден' });
    }

    const { rows } = await db.query(
      'INSERT INTO practice_sessions (skill_id, duration_minutes, notes) VALUES (?, ?, ?) RETURNING *',
      [skill_id, duration, notes || null]
    );

    res.status(201).json({
      message: 'Сессия практики сохранена',
      session: rows[0],
      is_pomodoro: duration >= 25 && duration <= 45,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Ошибка при сохранении сессии' });
  }
};
