# SkillTracker MVP

Backend приложения для освоения навыков по методологии Josh Kaufman (*The First 20 Hours*).

## Концепция

| Принцип | Как реализован |
|---|---|
| **Деконструкция навыка** | Навык разбивается на 4–6 изолированных модулей (`POST /api/skills` с массивом `modules`) |
| **Правило 20 часов** | Каждый навык имеет `target_hours` (по умолчанию 20). Прогресс считается как `total_minutes / (target_hours × 60)` |
| **Микро-сессии (Помодоро)** | Сессии практики 25–45 минут; сессия попадает в статистику и возвращает флаг `is_pomodoro` |
| **Интервальное повторение** | Система Лейтнера: пройденный модуль возвращается на повтор через 1 день, затем интервалы 3 → 7 → 14 → 30 дней. Успешное повторение повышает стадию, неуспешное возвращает на стадию 1 |

## Стек

Node.js, Express 5, SQLite (sqlite3), JWT (jsonwebtoken), bcryptjs.

## Запуск

```bash
cp .env.example .env   # заполнить JWT_SECRET
npm install
npm run dev            # или: npm start
```

Сервер: `http://localhost:5001` (порт настраивается в `.env`; 5000 на macOS занят AirPlay-приёмником).

Схема БД создаётся автоматически при старте (`src/config/db.js`). Пересоздать вручную: `sqlite3 database.sqlite < schema.sql`.

## Структура

```
src/
├── config/db.js              # SQLite: подключение, схема, обёртка query() в стиле pg
├── controllers/
│   ├── authController.js     # register, login
│   ├── skillController.js    # навыки, модули, статистика
│   ├── sessionController.js  # сессии практики
│   └── reviewController.js   # интервальные повторения (Лейтнер)
├── middleware/authMiddleware.js
├── routes/
│   ├── authRoutes.js
│   ├── skillRoutes.js
│   ├── sessionRoutes.js
│   └── reviewRoutes.js
└── app.js                    # точка входа
```

## API

Все эндпоинты, кроме `/api/auth/*` и `/health`, требуют заголовок `Authorization: Bearer <token>`.

### Авторизация

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/auth/register` | Регистрация. Тело: `{ email, password }` → `{ token, user }` |
| POST | `/api/auth/login` | Вход. Тело: `{ email, password }` → `{ token, user }` |

### Навыки и модули

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/skills` | Список навыков с прогрессом и модулями |
| POST | `/api/skills` | Создать навык. Тело: `{ title, description?, target_hours?, modules: [{ title }] }` |
| GET | `/api/skills/:id/stats` | Статистика: минуты по дням (30 дней), серия дней подряд (streak) |
| PATCH | `/api/skills/modules/:moduleId` | Отметить модуль `{ is_completed: true|false }`. При завершении создаётся повторение, при отмене — удаляется |

### Практика

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/sessions` | Записать сессию. Тело: `{ skill_id, duration_minutes (1–480), notes? }` |

### Повторения (Лейтнер)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/reviews` | Что повторять сегодня |
| POST | `/api/reviews/:id` | Результат повторения `{ quality: "good" \| "bad" }` |
| GET | `/api/reviews/plan` | Расписание будущих повторений |

### Служебное

| Метод | Путь | Описание |
|---|---|---|
| GET | `/health` | Проверка живости сервера |

## Примеры (curl)

```bash
BASE=http://localhost:5001

# Регистрация
TOKEN=$(curl -s -X POST $BASE/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' | jq -r .token)

AUTH="Authorization: Bearer $TOKEN"

# Навык с деконструкцией на модули
curl -s -X POST $BASE/api/skills -H "$AUTH" -H "Content-Type: application/json" -d '{
  "title": "Гитара",
  "target_hours": 20,
  "modules": [{"title": "Баррэ"}, {"title": "Переходы"}, {"title": "Ритм-паттерны"}]
}'

# Список с прогрессом
curl -s $BASE/api/skills -H "$AUTH"

# Сессия практики (Помодоро)
curl -s -X POST $BASE/api/sessions -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"skill_id":1,"duration_minutes":30,"notes":"Баррэ медленно"}'

# Пройденный модуль -> создаётся повторение на завтра
curl -s -X PATCH $BASE/api/skills/modules/1 -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"is_completed":true}'

# Повторения
curl -s $BASE/api/reviews -H "$AUTH"
curl -s -X POST $BASE/api/reviews/1 -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"quality":"good"}'

# Статистика
curl -s $BASE/api/skills/1/stats -H "$AUTH"
```

## Развертывание (Render)

- Build: `npm install`
- Start: `npm start`
- Env: `JWT_SECRET`, `DB_PATH=/var/data/database.sqlite` (монтируемый диск — данные переживают redeploy)
