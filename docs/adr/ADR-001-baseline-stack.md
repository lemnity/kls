# ADR-001 — baseline stack

**Status:** accepted

## Decision

ЕВРОПА строится как TypeScript strict modular monolith в npm workspaces:

- `apps/web`: Next.js App Router;
- `apps/api`: NestJS + Fastify;
- `apps/worker`: отдельный Node.js процесс для фоновых задач;
- PostgreSQL — system of record, Redis — очередь/кэш, MinIO — объектное хранилище;
- Prisma ORM и SQL migrations — единственный путь изменения схемы;
- Docker Compose — локальный development-контур.

Финансовые значения хранятся в PostgreSQL `numeric`; в API не используются `float`/JS `number` для финансовых вычислений. Realtime и фоновые работы не становятся источником истины: состояние фиксируется в PostgreSQL.

## Consequences

- API остаётся единственной server-side границей авторизации и business mutations.
- Worker не принимает запросы пользователя и обрабатывает только идемпотентные задания.
- Локальные Docker credentials разрешены только в `.env.example`; production secrets передаются средой исполнения.
- Любой новый сервис вне монолита требует отдельного ADR.
