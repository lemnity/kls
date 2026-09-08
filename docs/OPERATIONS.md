# Operations

## Environments

- `development`: локальный Docker Compose и только синтетические данные.
- `demo/training`: отдельный tenant «Кулиса», без данных ТБДТ.
- `staging`: изолированный контур перед пилотом.
- `production`: выбирается театром до загрузки живых данных.

## Bootstrap

1. Скопировать `.env.example` в `.env` и заменить значения только локальными секретами.
2. Запустить Docker Desktop, выполнить `docker compose up -d`, дождаться healthy статуса всех сервисов.
3. Выполнить `npm run validate --workspace @kulisa/db` и `npm run migrate:deploy --workspace @kulisa/db`.
4. Проверить `npm test && npm run typecheck && npm run build`.

Для readiness API нужны `DATABASE_URL`, `REDIS_URL` и `S3_ENDPOINT`. Локальные значения в `.env.example` соответствуют изолированным портам Compose: `5434`, `6380` и `9002`.

Для synthetic demo tenant выполнить `DATABASE_URL=... npm run seed:demo --workspace @kulisa/db`. Команда идемпотентна и создаёт «Кулиса», пользователя `demo@demo.ru` с ролью `theatre_admin`, тестовую permission `platform.admin` и локальный demo-пароль `demo` (см. ниже); final production permission matrix и session не создаёт.

## Local pilot authentication

`POST /v1/auth/login` принимает `email` и `password`, возвращает opaque bearer token и устанавливает `Cache-Control: no-store`. В PostgreSQL сохраняется только SHA-256 hash токена; password хранится только как scrypt hash. Проверка `GET /v1/session` принимает `Authorization: Bearer <token>` и создаёт контекст только для active membership.

Demo-логин `demo@demo.ru` / `demo` — локальный dev/demo-only shortcut, который `seed:demo` сбрасывает при каждом запуске; это не controlled initial-admin provisioning flow (см. `docs/OPEN_QUESTIONS.md`) и не должен использоваться вне изолированного development/demo-контура.

## Migrations

Каждая migration проверяется на чистой БД перед merge; откат — через restore резервной копии, снятой до применения новой migration (Prisma migrate не генерирует автоматические down-migrations).

2026-09-08 выполнена измеренная проверка на изолированной scratch-БД (локальный Postgres, не project Docker Compose — тот же procedure применим к нему один в один, различается только `DATABASE_URL`):

1. `DATABASE_URL=... npm run migrate:deploy --workspace @kulisa/db` на чистой БД применил все 6 текущих migration без ошибок; `migrate:status` подтвердил актуальную схему.
2. `DATABASE_URL=... npm run seed:demo --workspace @kulisa/db` создал synthetic demo tenant поверх мигрированной схемы (staging-like data).
3. Снят backup: `pg_dump -Fc -f staging_copy.dump` (62 KB, ~0.2 сек) — это и есть «резервная копия staging-данных» из §1 плана, снятая после применения текущих migration и перед гипотетической следующей.
4. Симулирован инцидент: `DROP DATABASE` + `CREATE DATABASE` (чистая БД).
5. Rollback: `pg_restore -d <db> staging_copy.dump` — 3.2 секунды, без ошибок.
6. Проверка: `migrate:status` после restore снова подтвердил актуальную схему (все 6 migration); построчные counts всех 21 таблицы (`tenants`, `users`, `memberships`, `roles`, `permissions`, `role_permissions`, `password_credentials`, остальные — по фактическим данным) совпали до и после restore; identity-данные (`tenants.name = 'Кулиса'`, `users.email = 'demo@demo.ru'`) сверены точечно.
7. Scratch-БД и dump удалены после проверки.

Наблюдаемые локальные метрики: migration apply на чистой БД — без измеримой задержки (<1 сек на 6 migration); backup 62 KB — 0.2 сек; restore — 3.2 сек. Это не production RTO — не проверены object storage, сетевая передача backup и реальный объём staging-данных.

## Backup and restore

Ежедневный backup PostgreSQL и inventory object storage обязательны до пилота. Backup хранится отдельно от рабочей VM/volume и шифруется. Restore drill выполняется в чистом staging-контуре: восстановить БД/файлы, проверить checksum выборки assets и вход demo пользователя.

Локальный development-контур проверен 2026-09-05: PostgreSQL, Redis и MinIO healthy; Prisma schema содержит 2 применённые migration.

2026-09-05 выполнен измеренный database-only restore drill на synthetic development-БД. Custom-format dump `europa` размером 20 KB был восстановлен в отдельную `europa_restore_measure_20260905`; сверены tenant «Театр Европа», permission `platform.admin` и 2 migration, а counts tenant/user/membership/role/permission совпали с источником. Backup + restore + validation заняли 2 секунды. Временная БД и оба dump-файла удалены после проверки.

Фактический локальный database-only RTO: 2 секунды для текущего 20 KB synthetic snapshot. Наблюдаемый RPO для единственного ручного snapshot — 0 на момент его создания; целевой RPO не определён, пока нет расписания и retention. Это не production RTO/RPO: не проверены object storage inventory/checksum, зашифрованное внешнее хранение, восстановление файлов, controlled demo login и отдельный staging-контур.

## Security

Production secrets не хранятся в Git и не попадают в логи. API readiness не выводит DSN, ключи или причины недоступности зависимости. Доступ к файлу проверяется до выдачи подписанной ссылки.
