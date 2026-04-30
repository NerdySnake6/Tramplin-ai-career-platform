# Трамплин

Трамплин — интерактивная карьерная платформа для студентов, выпускников, работодателей, кураторов и администратора.

В проекте есть:

- главная страница с интерактивной картой и лентой возможностей
- карточки вакансий, стажировок, менторских программ и событий
- ролевая модель: `applicant`, `employer`, `curator`, `admin`
- отклики и статусы откликов
- нетворкинг между соискателями
- базовая SEO-подготовка (Sitemap, Robots.txt, Яндекс Метрика, Яндекс Вебмастер, Google Search Console)
- ручная модерация работодателей: до верификации работодатель может создать до 5 карточек, а демо-автоверификация включается переменной `TRAMPLIN_AUTO_VERIFY_EMPLOYERS`

## Стек

- **Backend**: `FastAPI`, `SQLAlchemy`, `Alembic`, `SQLite`
- **Frontend**: `JavaScript`, `Node.js`, `Vite`, `Bootstrap`
- **Интеграции**: `Yandex Maps JavaScript API`, `Yandex HTTP Geocoder`, `Яндекс Метрика`

## Структура проекта

- `backend/` — API, модели, миграции и база данных SQLite
- `frontend/` — клиентское приложение на Vite

## Production-архитектура

В production проект запускается через `docker-compose.yml` как два контейнера:

```mermaid
flowchart LR
    U["Браузер"] --> D["tramplin.site DNS"]
    D --> V["VPS: 80/443"]
    V --> N["frontend container: nginx"]
    N --> S["static SPA: /usr/share/nginx/html"]
    N -->|"/api/*"| B["backend container: FastAPI :8000"]
    B --> DB["SQLite: Docker volume /data/tramplin.db"]
    B --> YG["Yandex HTTP Geocoder"]
    U --> YM["Yandex Maps JS API"]
```

- наружу опубликован только `frontend`-контейнер на портах `80` и `443`
- nginx внутри `frontend` отдает собранный Vite frontend и проксирует `/api/*` в backend
- backend доступен только внутри Docker-сети по имени `backend:8000`
- SQLite-база хранится в named volume `tramplin_backend_data`, а не внутри контейнера
- TLS-сертификаты Let's Encrypt лежат на VPS в `/etc/letsencrypt` и монтируются в nginx read-only
- backend при старте применяет Alembic-миграции и затем запускает FastAPI через Uvicorn
- `www.tramplin.site` редиректит на canonical-домен `tramplin.site`
- nginx добавляет security headers, CSP и долгий immutable-cache для собранных `/assets/*`

## Что нужно для запуска

- `git`
- `Python 3.11`
- `pip`
- `Node.js 20+`
- `npm`

Если на macOS не установлен `python3.11`, можно поставить его через Homebrew:

```bash
brew install python@3.11
```

## Клонирование репозитория

```bash
git clone https://github.com/NerdySnake6/if-else-hackathon-2026.git
cd if-else-hackathon-2026
```

## Переменные окружения

Перед запуском нужны два файла:

1. `backend/.env`
2. `frontend/.env.local`

Файлы `backend/.env.example` и `frontend/.env.example` лежат в репозитории как шаблоны.

### Как получить ключ Яндекс Карт

1. Перейди на [Yandex Maps API](https://yandex.ru/maps-api/)
2. Открой личный кабинет
3. Нажми `Подключить API`
4. Выбери пакет `JavaScript API и HTTP Геокодер`
5. Создай новый ключ

В проекте используется один и тот же ключ для frontend и backend.

### `backend/.env`

Создай файл `backend/.env`:

```env
YANDEX_GEOCODER_API_KEY=твой_ключ_яндекс_карт
```

Где:

- `YANDEX_GEOCODER_API_KEY` — ключ Яндекс Карт

### `frontend/.env.local`

Создай файл `frontend/.env.local`:

```env
VITE_YANDEX_MAPS_API_KEY=твой_ключ_яндекс_карт
```

Где:

- `VITE_YANDEX_MAPS_API_KEY` — тот же ключ, что и в `backend/.env`

Важно:

- backend автоматически читает `backend/.env` при запуске
- после изменения `backend/.env` или `frontend/.env.local` нужно перезапустить backend и frontend

## Быстрый старт на macOS / Linux

### 1. Запуск backend

```bash
cd backend
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3.11 -m alembic upgrade head
uvicorn app.main:app 
```

Backend будет доступен по адресу:

- [http://127.0.0.1:8000](http://127.0.0.1:8000)
- Swagger: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

### 2. Запуск frontend

Открой второй терминал:

```bash
cd frontend
npm install
npm run dev
```

Frontend будет доступен по адресу:

- [http://127.0.0.1:5173](http://127.0.0.1:5173)

Во время локальной разработки frontend отправляет запросы в backend через Vite proxy на `http://localhost:8000`.

## Быстрый старт на Windows

### 1. Запуск backend

```bash
cd backend
py -3.11 -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python -m alembic upgrade head
uvicorn app.main:app 
```

### 2. Запуск frontend

Открой второй терминал:

```bash
cd frontend
npm install
npm run dev
```

Адреса останутся теми же:

- backend: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- frontend: [http://127.0.0.1:5173](http://127.0.0.1:5173)

## Запуск через Docker на VPS

В репозитории есть готовая Docker-конфигурация:

- `docker-compose.yml` — поднимает backend и frontend
- `backend/Dockerfile` — FastAPI, Alembic и SQLite
- `frontend/Dockerfile` — production-сборка Vite и nginx

### 1. Подготовить переменные окружения

Создай файл `.env` в корне проекта:

```bash
cp docker.env.example .env
```

Заполни значения:

```env
YANDEX_GEOCODER_API_KEY=твой_ключ_яндекс_карт
VITE_YANDEX_MAPS_API_KEY=твой_ключ_яндекс_карт
TRAMPLIN_SECRET_KEY=случайная_длинная_строка
TRAMPLIN_ADMIN_EMAIL=admin@example.com
TRAMPLIN_ADMIN_PASSWORD=надежный_пароль
TRAMPLIN_ADMIN_NAME=Администратор
TRAMPLIN_AUTO_VERIFY_EMPLOYERS=false
SMTP_HOST=smtp.yandex.com
SMTP_PORT=587
SMTP_USERNAME=noreply@tramplin.site
SMTP_PASSWORD=пароль_приложения_яндекс_почты
SMTP_FROM_EMAIL=noreply@tramplin.site
SMTP_FROM_NAME=Трамплин
BACKEND_PUBLIC_URL=https://tramplin.site/api
FRONTEND_PUBLIC_URL=https://tramplin.site
EMAIL_VERIFICATION_TTL_MINUTES=60
FRONTEND_PORT=80
FRONTEND_HTTPS_PORT=443
```

### 2. Подключить почту `noreply@tramplin.site`

Email-подтверждение использует SMTP и отправляет письма от имени `noreply@tramplin.site`.
Секреты почты хранятся только в `.env` на VPS.

1. Создай организацию в Yandex 360 и подключи домен `tramplin.site`.
2. В DNS домена добавь записи, которые покажет Yandex 360. Для почты обычно нужны:

```text
MX   @                mx.yandex.net
TXT  @                v=spf1 redirect=_spf.yandex.net
TXT  mail._domainkey  DKIM-ключ из Yandex 360
TXT  _dmarc           v=DMARC1; p=none; rua=mailto:noreply@tramplin.site
```

3. После подтверждения домена создай ящик `noreply@tramplin.site`.
4. В настройках Yandex ID для этого ящика создай пароль приложения типа `Почта`.
5. Вставь пароль приложения в `SMTP_PASSWORD` в `.env` на VPS.

Если письма не отправляются, проверь `docker compose logs -f backend`, правильность `SMTP_PASSWORD` и статус DNS-записей в Yandex 360.

### 3. Запустить проект

```bash
docker compose up -d --build
```

После запуска:

- frontend будет доступен на `https://tramplin.site/`
- backend будет доступен внутри Docker-сети как `backend:8000`
- Swagger и OpenAPI в production закрыты nginx-конфигом

### 4. Проверить состояние контейнеров

```bash
docker compose ps
docker compose logs -f backend
```

При старте backend автоматически применяет миграции Alembic и создает SQLite-базу в Docker volume.

## Первый администратор

После применения миграций и первого запуска backend в базе автоматически создается один администратор, если пользователя с ролью `admin` еще нет и явно заданы переменные окружения администратора.

Это происходит после выполнения команд:

```bash
cd backend
source venv/bin/activate
python3.11 -m alembic upgrade head
uvicorn app.main:app --reload
```

Перед первым запуском задай данные администратора в окружении:

```env
TRAMPLIN_ADMIN_EMAIL=admin@example.com
TRAMPLIN_ADMIN_PASSWORD=надежный_пароль
TRAMPLIN_ADMIN_NAME=Администратор
```

Важно:

- администратор создается только если в БД еще нет роли `admin`
- если `TRAMPLIN_ADMIN_EMAIL` или `TRAMPLIN_ADMIN_PASSWORD` не заданы, администратор автоматически не создается
- в базе хранится не открытый пароль, а его хеш
- входить нужно обычным паролем, который был задан при инициализации
- `TRAMPLIN_AUTO_VERIFY_EMPLOYERS=false` оставляет ручную модерацию работодателей; значение `true` стоит включать только для закрытого демо-режима

При необходимости данные администратора можно переопределить через переменные окружения backend.

## Что проверить после запуска

1. Открывается frontend на `http://127.0.0.1:5173`
2. Открывается backend на `http://127.0.0.1:8000/docs`
3. На главной странице отображаются карта и карточки возможностей
4. Можно войти под администратором, заданным через переменные окружения

## CI/CD

В репозитории настроены GitHub Actions:

- `.github/workflows/ci.yml` — проверка backend и сборка frontend для `push` и `pull_request`
- `.github/workflows/cd.yml` — сборка артефактов на ветке `main`

CI проверяет:

- синтаксис Python-модулей backend
- backend-тесты основных сценариев
- production-сборку frontend

Для workflow может понадобиться GitHub Secret:

- `VITE_YANDEX_MAPS_API_KEY`

## Полезные замечания

- если маркеры на карте не появляются, сначала проверь `YANDEX_GEOCODER_API_KEY`, `VITE_YANDEX_MAPS_API_KEY` и CSP в `frontend/nginx.conf`
- если менялись `.env`-файлы, всегда перезапускай backend и frontend
- если база не совпадает с миграциями, backend попросит сначала выполнить `alembic upgrade head`

## Проект в сети

Ознакомиться с рабочей версией проекта можно на **[официальном сайте «Трамплин»](https://tramplin.site/)**.
