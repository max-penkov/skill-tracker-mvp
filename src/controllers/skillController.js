const db = require('../config/db');

// Получение списка всех навыков пользователя с прогрессом по правилу 20 часов
exports.getUserSkills = async (req, res) => {
  try {
    const userId = req.user.id;

    // Суммы через подзапросы — без фан-аута от двойного JOIN
    const skillsQuery = `
      SELECT s.*,
        COALESCE((SELECT SUM(ps.duration_minutes) FROM practice_sessions ps WHERE ps.skill_id = s.id), 0) AS total_minutes_practiced,
        COALESCE((SELECT COUNT(*) FROM modules m WHERE m.skill_id = s.id), 0) AS modules_total,
        COALESCE((SELECT COUNT(*) FROM modules m WHERE m.skill_id = s.id AND m.is_completed = 1), 0) AS modules_completed
      FROM skills s
      WHERE s.user_id = ?
      ORDER BY s.created_at DESC;
    `;
    const { rows: skills } = await db.query(skillsQuery, [userId]);

    if (skills.length === 0) return res.json([]);

    const skillIds = skills.map((s) => s.id);
    const placeholders = skillIds.map(() => '?').join(',');
    const { rows: modules } = await db.query(
      `SELECT id, skill_id, title, is_completed, order_index
       FROM modules WHERE skill_id IN (${placeholders}) ORDER BY order_index`,
      skillIds
    );

    const result = skills.map((skill) => {
      const target_minutes = (skill.target_hours || 20) * 60;
      const total = Number(skill.total_minutes_practiced) || 0;
      return {
        ...skill,
        total_minutes_practiced: total,
        target_minutes,
        progress_percent: Math.min(100, Math.round((total / target_minutes) * 100)),
        remaining_minutes: Math.max(0, target_minutes - total),
        modules: modules.filter((m) => m.skill_id === skill.id),
      };
    });

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Ошибка сервера при получении навыков' });
  }
};

// Создание нового навыка с модулями (деконструкция навыка)
exports.createSkill = async (req, res) => {
  const { title, description, target_hours = 20, modules = [] } = req.body;
  const userId = req.user.id;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ message: 'Укажите название навыка' });
  }
  if (!Array.isArray(modules) || modules.some((m) => !m || !m.title || !m.title.trim())) {
    return res.status(400).json({ message: 'Модули должны быть массивом объектов с полем title' });
  }

  try {
    await db.run('BEGIN');
    const { rows } = await db.query(
      'INSERT INTO skills (user_id, title, description, target_hours) VALUES (?, ?, ?, ?) RETURNING *',
      [userId, title.trim(), description || null, target_hours]
    );
    const newSkill = rows[0];

    for (let i = 0; i < modules.length; i++) {
      await db.run('INSERT INTO modules (skill_id, title, order_index) VALUES (?, ?, ?)', [
        newSkill.id,
        modules[i].title.trim(),
        i + 1,
      ]);
    }
    await db.run('COMMIT');

    const { rows: savedModules } = await db.query(
      'SELECT id, title, is_completed, order_index FROM modules WHERE skill_id = ? ORDER BY order_index',
      [newSkill.id]
    );
    res.status(201).json({ message: 'Навык успешно создан', skill: newSkill, modules: savedModules });
  } catch (error) {
    await db.run('ROLLBACK').catch(() => {});
    console.error(error);
    res.status(500).json({ message: 'Ошибка при создании навыка' });
  }
};

// Отметка модуля как пройденного (+ запись в расписание повторений Leitner)
exports.toggleModule = async (req, res) => {
  const { moduleId } = req.params;
  const { is_completed } = req.body;
  const userId = req.user.id;

  if (typeof is_completed !== 'boolean') {
    return res.status(400).json({ message: 'is_completed должен быть true или false' });
  }

  try {
    // Проверка владельца: модуль принадлежит навыку текущего пользователя
    const { rows } = await db.query(
      `UPDATE modules SET is_completed = ?
       WHERE id = ?
         AND skill_id IN (SELECT id FROM skills WHERE user_id = ?)
       RETURNING *`,
      [is_completed ? 1 : 0, moduleId, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Модуль не найден' });
    }

    const module = rows[0];

    if (is_completed) {
      // Пройденный модуль возвращаем к повторению через 1 день
      await db.query(
        `INSERT INTO reviews (module_id, skill_id, user_id, stage, next_review_at)
         VALUES (?, ?, ?, 1, DATE('now', '+1 day'))
         ON CONFLICT(module_id) DO UPDATE SET
           stage = 1,
           next_review_at = DATE('now', '+1 day'),
           last_reviewed_at = NULL`,
        [module.id, module.skill_id, userId]
      );
    } else {
      await db.query('DELETE FROM reviews WHERE module_id = ?', [module.id]);
    }

    res.json({ ...module, is_completed: Boolean(is_completed) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Ошибка обновления модуля' });
  }
};

// Детальная статистика по навыку: минуты по дням (30 дней) и серия дней подряд
exports.getSkillStats = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { rows: skillRows } = await db.query(
      'SELECT * FROM skills WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    if (skillRows.length === 0) {
      return res.status(404).json({ message: 'Навык не найден' });
    }
    const skill = skillRows[0];

    const { rows: daily } = await db.query(
      `SELECT DATE(created_at) AS day, SUM(duration_minutes) AS minutes, COUNT(*) AS sessions
       FROM practice_sessions
       WHERE skill_id = ? AND created_at >= DATE('now', '-30 days')
       GROUP BY DATE(created_at)
       ORDER BY day DESC`,
      [id]
    );

    const totalRow = await db.get(
      'SELECT COALESCE(SUM(duration_minutes), 0) AS total FROM practice_sessions WHERE skill_id = ?',
      [id]
    );
    const total = Number(totalRow.total) || 0;
    const target_minutes = (skill.target_hours || 20) * 60;

    // Streak: подряд идущие дни с практикой, считаем от сегодня или вчера
    const practicedDays = new Set(daily.map((d) => d.day));
    let streak = 0;
    const cursor = new Date();
    if (!practicedDays.has(cursor.toISOString().slice(0, 10))) {
      cursor.setDate(cursor.getDate() - 1); // сегодня ещё не практиковал — streak держится со вчера
    }
    while (practicedDays.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    res.json({
      skill: { id: skill.id, title: skill.title, target_hours: skill.target_hours },
      total_minutes_practiced: total,
      target_minutes,
      progress_percent: Math.min(100, Math.round((total / target_minutes) * 100)),
      remaining_minutes: Math.max(0, target_minutes - total),
      streak_days: streak,
      daily: daily.map((d) => ({ day: d.day, minutes: Number(d.minutes), sessions: d.sessions })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Ошибка сервера при получении статистики' });
  }
};
