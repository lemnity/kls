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

## Backup and restore

Ежедневный backup PostgreSQL и inventory object storage обязательны до пилота. Backup хранится отдельно от рабочей VM/volume и шифруется. Restore drill выполняется в чистом staging-контуре: восстановить БД/файлы, проверить checksum выборки assets и вход demo пользователя.

Локальный development-контур проверен 2026-09-05: PostgreSQL, Redis и MinIO healthy; Prisma schema содержит 2 применённые migration.

2026-09-05 выполнен измеренный database-only restore drill на synthetic development-БД. Custom-format dump `europa` размером 20 KB был восстановлен в отдельную `europa_restore_measure_20260905`; сверены tenant «Театр Европа», permission `platform.admin` и 2 migration, а counts tenant/user/membership/role/permission совпали с источником. Backup + restore + validation заняли 2 секунды. Временная БД и оба dump-файла удалены после проверки.

Фактический локальный database-only RTO: 2 секунды для текущего 20 KB synthetic snapshot. Наблюдаемый RPO для единственного ручного snapshot — 0 на момент его создания; целевой RPO не определён, пока нет расписания и retention. Это не production RTO/RPO: не проверены object storage inventory/checksum, зашифрованное внешнее хранение, восстановление файлов, controlled demo login и отдельный staging-контур.

## Security

Production secrets не хранятся в Git и не попадают в логи. API readiness не выводит DSN, ключи или причины недоступности зависимости. Доступ к файлу проверяется до выдачи подписанной ссылки.
