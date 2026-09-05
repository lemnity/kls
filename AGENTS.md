# AGENTS.md

## Project
«ЕВРОПА» — система управления театральной постановкой от сметы до проката.

Основной поток:
смета → задачи цехам → согласования → договоры и акты → паспорт спектакля → репетиции → прокат и деньги.

## Source of truth
1. docs/PRODUCT_SPEC.md
2. docs/ACCEPTANCE.md
3. docs/DATA_MODEL.md
4. docs/ARCHITECTURE.md
5. docs/adr/*
6. source code

Если требования конфликтуют — не угадывать. Добавить вопрос в docs/OPEN_QUESTIONS.md.

## Engineering rules
- TypeScript strict.
- Не использовать any без причины.
- Все tenant-owned сущности имеют tenant_id.
- Авторизация проверяется на backend.
- UI не является границей безопасности.
- Деньги хранятся decimal/numeric, не float.
- Все критические действия пишутся в audit log.
- Все изменения БД идут через migrations.
- Любой новый endpoint: validation + auth + authorization + tests.
- Критические пользовательские сценарии покрываются E2E.
- Секреты не хранятся в git.
- Не строить микросервисы без ADR.
- Не реализовывать интеграции вне текущего scope.

## Development style
Работать вертикальными сценариями. Не писать весь backend, затем весь frontend.

## Definition of Done
lint + typecheck + tests + migrations + authz + tenant isolation + docs + no blocker/critical review findings.
