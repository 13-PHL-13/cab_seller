# Реализация собственной авторизации

Ветка: `feat/local-user-auth`  
PR: https://github.com/13-PHL-13/cab_seller/pull/2

## Что уже реализовано в этой ветке

- Серверное хеширование паролей через Node.js scrypt с уникальной солью.
- Случайные opaque session tokens; в PostgreSQL сохраняется только SHA-256 хеш токена.
- HttpOnly cookie, SameSite=Lax, Secure и префикс __Host- в production.
- Регистрация с подтверждением email.
- Вход только после подтверждения email.
- Выход с текущего устройства и отзыв всех сессий.
- Запрос сброса пароля с одинаковым ответом для существующих и неизвестных адресов; отправка письма выполняется асинхронно.
- Унифицированные ответы регистрации и входа уменьшают риск перечисления зарегистрированных адресов.
- Одноразовый токен сброса пароля; при смене пароля отзываются все активные сессии.
- SMTP-доставка писем через implicit TLS на порту 465.
- Переключение marketplace middleware с Clerk на локальные серверные сессии.
- Форма входа/регистрации, подтверждение email, восстановление и смена пароля.
- Удалены Clerk зависимости из package.json API и frontend; удалён неиспользуемый Clerk proxy middleware.
- Vite dev proxy для /api на локальный Express API.

## Локальная конфигурация

1. Создать PostgreSQL базу и задать `DATABASE_URL`.
2. Скопировать `artifacts/api-server/.env.example` в локальный env-файл API и заполнить реальные значения.
3. Для почты настроить SMTP сервер с implicit TLS, порт 465. Нужны SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM.
4. Задать APP_ORIGIN равным адресу frontend, например `http://localhost:4173`.
5. Сгенерировать уникальный SESSION_SECRET. Он также используется существующим AES-256-GCM шифрованием API-ключей маркетплейсов. При его смене ранее зашифрованные ключи не расшифруются — до смены секрета нужна отдельная процедура re-encryption.
6. Применить Drizzle schema к тестовой БД командой `pnpm --filter @workspace/db push`. Не запускать push на production без backup и review.
7. В первом терминале запустить API с `PORT=3001`.
8. Во втором терминале запустить frontend, например на `PORT=4173`. Vite проксирует `/api` на `http://127.0.0.1:3001`.

PowerShell пример запуска:

```powershell
$env:PORT="3001"
pnpm --filter @workspace/api-server dev
```

В другом окне PowerShell:

```powershell
$env:PORT="4173"
$env:BASE_PATH="/"
pnpm --filter @workspace/marketplace-cabinet dev
```

## Ограничения и обязательные проверки до production

- Встроенный rate limiter хранит счётчики в памяти процесса. Для нескольких API-инстансов нужен общий Redis/совместимый limiter; лимиты также нужно настроить по нагрузочному тесту.
- SMTP transport первой версии поддерживает implicit TLS на порту 465. Проверить совместимость с выбранным почтовым провайдером и deliverability.
- Нужны интеграционные тесты с реальным PostgreSQL: регистрация, подтверждение, вход, cookies, logout, reset, повторное использование токена, истечение сессии и изоляция пользователей A/B.
- Нужен аудит всех marketplace endpoints и всех фоновых задач на отсутствие доступа по произвольному ownerId.
- Нужно проверить build/typecheck и lockfile через чистый `pnpm install`; в среде разработки без сетевого доступа эти проверки не запускались.
- Нужны миграция/backup/restore, HTTPS, reverse proxy, SMTP credentials, production secrets и правовая проверка 152-ФЗ.
- Существующие записи Clerk owner IDs не перепривязываются к новым аккаунтам автоматически.
- Не объединять PR до прохождения перечисленных проверок.
