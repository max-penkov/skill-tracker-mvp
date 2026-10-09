const db = require('../config/db');

// Интервалы Leitner: стадия 1 -> 1 день, 2 -> 3, 3 -> 7, 4 -> 14, 5 -> 30
const INTERVALS = [1, 3, 7, 14, 30];
const MAX_STAGE = INTERVALS.length;

// Что повторять сегодня (и раньше)
exports.getDueReviews = async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows } = await db.query(
      `SELECT r.*, m.title AS module_title, s.title AS skill_title
       FROM reviews r
       JOIN modules m ON r.module_id = m.id
       JOIN skills s ON r.skill_id = s.id
       WHERE r.user_id = ? AND r.next_review_at <= DATE('now')
       ORDER BY r.next_review_at ASC`,
      [userId]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Ошибка сервера при получении повторений' });
  }
};

// Результат повторения: good — стадия вверх, bad — возврат на стадию 1
exports.submitReview = async (req, res) => {
  const { id } = req.params;
  const { quality } = req.body;
  const userId = req.user.id;

  if (!['good', 'bad'].includes(quality)) {
    return res.status(400).json({ message: 'quality должен быть good или bad' });
  }

  try {
    const { rows } = await db.query('SELECT * FROM reviews WHERE id = ? AND user_id = ?', [
      id,
      userId,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Повторение не найдено' });
    }

    const review = rows[0];
    const newStage =
      quality === 'good' ? Math.min(review.stage + 1, MAX_STAGE) : 1;
    const intervalDays = INTERVALS[newStage - 1];

    const { rows: updated } = await db.query(
      `UPDATE reviews
       SET stage = ?, next_review_at = DATE('now', '+' || ? || ' day'), last_reviewed_at = DATE('now')
       WHERE id = ?
       RETURNING *`,
      [newStage, intervalDays, id]
    );

    res.json({
      message:
        quality === 'good'
          ? `Отлично! Следующее повторение через ${intervalDays} дн. (стадия ${newStage})`
          : `Ничего страшного, возвращаемся к стадии 1 — повторим завтра`,
      review: updated[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Ошибка сервера при сохранении результата' });
  }
};

// Расписание будущих повторений
exports.getPlan = async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows } = await db.query(
      `SELECT r.id, r.module_id, r.stage, r.next_review_at,
              m.title AS module_title, s.title AS skill_title
       FROM reviews r
       JOIN modules m ON r.module_id = m.id
       JOIN skills s ON r.skill_id = s.id
       WHERE r.user_id = ?
       ORDER BY r.next_review_at ASC`,
      [userId]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Ошибка сервера при получении расписания' });
  }
};
