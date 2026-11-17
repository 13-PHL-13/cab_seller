# Техническое задание: собственная авторизация «Навигатора продаж»

Статус: согласовано к реализации  
Ветка: `feat/local-user-auth`  
Базовая ветка: `main`  
Модель продукта: отдельный личный кабинет на пользователя  
Регистрация: открытая для всех  
Основная аудитория: пользователи из России

## 1. Цель

Заменить зависимость от Clerk собственной серверной системой регистрации и авторизации, доступной пользователям из России. Сохранить React/Vite frontend, Express API, PostgreSQL и Drizzle ORM. Каждый аккаунт получает личный кабинет, доступный с нескольких устройств.

Не создавать организации, команды, приглашения и корпоративные роли в первой версии.

## 2. Архитектура

- Frontend: React 19 + Vite. Не содержит секретов и самостоятельно не принимает решений о доступе.
- Backend: Express 5. Все защищённые API проверяют серверную сессию.
- База: PostgreSQL через существующий пакет `@workspace/db` и Drizzle.
- Пароли: Node.js `crypto.scrypt` с уникальной случайной солью и параметрами N=32768, r=8, p=1 (или более сильными параметрами после проверки ресурсов); сравнение хешей через `timingSafeEqual`. Формат хеша версионируется.
- Сессии: криптографически случайный токен не менее 32 байт; в БД хранится только SHA-256 хеш токена. Cookie: HttpOnly, Secure в production, SameSite=Lax, Path=/, без Domain; имя `__Host-session` в production.
- Почта: SMTP-провайдер с российской доступностью/доставкой. Адрес отправителя и SMTP-секреты — только на backend.
- Защита: HTTPS, проверка Origin для state-changing запросов, rate limiting на регистрацию/вход/восстановление, единообразные ошибки входа, запрет утечки существования email, очистка токенов и истёкших сессий.

## 3. Модель данных

### users
- id UUID primary key
- email normalized (lowercase + trim), unique
- password_hash
- email_verified_at nullable
- status: active | disabled
- created_at, updated_at, last_login_at

### sessions
- id UUID primary key
- user_id FK -> users.id, on delete cascade
- token_hash unique
- expires_at, created_at, last_seen_at
- user_agent nullable, ip_address nullable (минимизация и срок хранения должны быть определены политикой приватности)

### email_verification_tokens
- id UUID primary key
- user_id FK
- token_hash unique
- expires_at, created_at, used_at nullable

### password_reset_tokens
- id UUID primary key
- user_id FK
- token_hash unique
- expires_at, created_at, used_at nullable

Marketplace connections:
- `marketplace_connections.owner_id` остаётся текстовым идентификатором владельца на первом этапе, но новые записи используют UUID `users.id`.
- Все запросы к подключениям продолжают фильтроваться по ID текущего пользователя.
- Не переносить и не привязывать старые Clerk owner IDs автоматически. До утверждения процедуры восстановления старые записи остаются нетронутыми и недоступными новым аккаунтам. Нужен отдельный безопасный процесс подтверждённого сопоставления legacy аккаунта, если сохранение старых подключений потребуется.

## 4. API

Публичные endpoints:
- POST /api/auth/register — email + пароль; валидация, создание пользователя, отправка подтверждения.
- POST /api/auth/verify-email — одноразовый токен, срок действия ограничен.
- POST /api/auth/login — проверка подтверждённого email, создание сессии и cookie.
- POST /api/auth/forgot-password — всегда одинаковый ответ независимо от наличия email.
- POST /api/auth/reset-password — проверка одноразового токена, смена пароля и отзыв всех сессий.
- GET /api/auth/me — текущий пользователь или 401.
- POST /api/auth/logout — отзыв текущей сессии и очистка cookie.
- POST /api/auth/logout-all — отзыв всех сессий пользователя.

Защищённые marketplace endpoints требуют действительную сессию и используют только user ID из серверного контекста, никогда не из тела запроса или query string.

## 5. Frontend

- Удалить `@clerk/react`, ClerkProvider, Show, SignInButton и UserButton.
- На старте запросить `GET /api/auth/me`.
- Публичные экраны: вход, регистрация, подтверждение email, запрос сброса и установка нового пароля.
- После входа показывать существующий App.
- Добавить выход из аккаунта и базовый экран профиля.
- Все API-запросы используют same-origin и `credentials: "include"`.
- Состояния загрузки, ошибок, отсутствующей сессии и неподтверждённого email должны быть явными.

## 6. Безопасность и приватность

- Никакого хранения session token или пароля в localStorage/sessionStorage.
- Никаких секретов SMTP, pepper или ключей подписи во frontend.
- Не возвращать password_hash, token_hash и секретные поля API.
- Секреты задаются через серверные переменные окружения.
- Секретный параметр pepper (если включён) не хранится в БД; его ротация должна быть предусмотрена.
- Проверять Origin/Referer для cookie-authenticated POST/PUT/PATCH/DELETE; CORS по умолчанию same-origin.
- Ограничивать размер тела запросов и частоту auth endpoints.
- Не логировать пароли, токены, cookies и marketplace API-ключи.
- HTTPS обязателен для production.
- Перед production провести правовую проверку требований 152-ФЗ, локализации первичного сбора и хранения персональных данных граждан РФ, политики конфиденциальности и согласий. География пользователей сама по себе не означает автоматическое соответствие закону.

## 7. Конфигурация

Backend:
- DATABASE_URL
- SESSION_TTL_DAYS
- APP_ORIGIN
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
- NODE_ENV

Frontend:
- не требуется auth secret или Clerk publishable key.

В production запускать frontend и API за одним HTTPS origin (reverse proxy), чтобы cookie были first-party.

## 8. Миграция и обратная совместимость

- Удаление Clerk middleware и proxy выполняется только вместе с включением собственной auth middleware.
- Не выпускать состояние, в котором marketplace API открыт без авторизации.
- Существующие marketplace rows и зашифрованные credentials не удалять.
- Не считать Clerk user ID эквивалентным новому UUID.
- Сначала схема и API, затем frontend, затем тесты и развёртывание.
- Переключение production только после проверки SMTP, HTTPS, миграций, backup/restore и тестов изоляции.

## 9. Критерии приёмки

1. Пользователь может зарегистрироваться с валидным email и сильным паролем.
2. До подтверждения email вход не разрешён.
3. Подтверждение и сброс пароля работают по одноразовым токенам с TTL.
4. После входа сервер устанавливает HttpOnly cookie; токен в БД хранится только в хешированном виде.
5. Несколько устройств создают отдельные сессии; выход с одного устройства отзывает только текущую, logout-all отзывает все.
6. Неавторизованный запрос к любому marketplace endpoint получает 401.
7. Пользователь A не может читать, изменять или удалять marketplace connection пользователя B.
8. Frontend не зависит от Clerk и не содержит секретов.
9. Typecheck, build и автоматические auth/security tests проходят.
10. Main и ранее слитый PR #1 не переписываются; работа ведётся в отдельной ветке и отдельном PR.

## 10. Этапы реализации

1. Схема Drizzle, auth service, middleware и API.
2. Почтовые токены и SMTP.
3. Frontend auth flow и профиль.
4. Изоляция существующих marketplace endpoints.
5. Unit/integration tests, CI, review.
6. Отдельный deployment runbook и production rollout после предоставления инфраструктурных секретов владельцем проекта.
