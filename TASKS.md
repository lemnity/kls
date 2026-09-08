# Sprint 0 tasks

1. [x] Запустить Docker Desktop и подтвердить health PostgreSQL, Redis и MinIO.
2. [x] На чистой PostgreSQL применить `npm run migrate:deploy --workspace @kulisa/db` и проверить `migrate:status`.
3. [x] Добавить DB integration test: cross-tenant membership→role и audit actor linkage отклоняются БД.
4. [x] Добавить Prisma repository scope, который требует `tenantId` для tenant-owned reads/writes.
5. [x] Подключить реальные PostgreSQL/Redis/MinIO probes к API `/ready`.
6. [x] Создать синтетический demo tenant «Кулиса» через idempotent seed.
7. [x] Реализовать session verification и создание `RequestContext` из active membership.
8. [x] Добавить API authorization guard и permission fixture для demo tenant.
9. [x] Провести E2E: user tenant A не читает/не изменяет tenant B.
10. [x] Провести backup/restore drill и записать фактические RPO/RTO в `docs/OPERATIONS.md`.

Не начинать Sprint 1 до закрытия пунктов 1–9 и документирования результата пункта 10.
