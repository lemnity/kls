# ADR-002 — multi-tenancy и authorization

**Status:** accepted

## Decision

Каждая tenant-owned сущность имеет `tenant_id`. Tenant context создаётся только после проверки активного membership текущего пользователя; значения tenant из URL, query и body не дают полномочий.

Все server-side выборки tenant-owned данных получают tenant scope. БД использует составные foreign keys для связей, которые обязаны оставаться в одном tenant: membership → role и audit event → actor membership.

Role/permission проверяется в API до mutation. UI не является security boundary. Critical mutations создают audit event в одной транзакции с business mutation.

## Audit

`audit_events` append-only: SQL trigger запрещает `UPDATE` и `DELETE`. Событие содержит tenant, actor membership, action, subject, changes и timestamp. Комментарии и чат не заменяют audit evidence.

## Consequences

- Межtenant доступ завершается fail closed и не раскрывает существование чужой записи.
- Новая tenant-owned таблица обязана иметь migration, tenant index, API authz и cross-tenant integration test.
- Изменение или удаление audit evidence выполняется только через новую миграцию и новый ADR.
