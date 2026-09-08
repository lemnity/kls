# Платформа КУЛИСА — подробный план реализации платформы

> **Для исполнителя:** выполнять задачи последовательно, отмечая чекбоксы. Перед началом каждого блока прочитать `AGENTS.md`, `docs/PRODUCT_SPEC.md`, `docs/ACCEPTANCE.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` и актуальные ADR. Не переходить к следующему инкременту, пока не пройдены его проверки и приёмка.

**Цель:** создать браузерную систему управления постановкой: от первой сметы и задач цехам до паспорта спектакля, репетиций, проката, визуальной сметы и внутренних коммуникаций.

**Архитектура:** TypeScript strict, modular monolith. `apps/web` (Next.js) обслуживает интерфейс, `apps/api` (NestJS) — единственную серверную границу данных и авторизации, `apps/worker` — фоновые задания. PostgreSQL — источник истины, Redis — очередь и transient-кэш, MinIO — файлы. WebSocket используется для доставки событий, но не как хранилище состояния.

**Поставка:** гибридная. Разработка и учебный tenant работают в изолированном облачном контуре. До начала работы с реальными данными театр и исполнитель письменно выбирают один из контуров пилота: защищённое облако или сервер театра. Нельзя переносить живые данные между контурами без инвентаря, зашифрованного экспорта, dry-run восстановления и приёмки ответственного лица театра.

**Плановая длительность:** 26 недель: обследование — 2 недели; Stage 01 — 10 недель разработки и пилота; Stage 02 — 8 недель; Stage 03 — 6 недель. Контрольные точки: неделя 2, 7, 12, 20 и 26.

## Подтверждённое выполнение

- [x] Создан TypeScript workspace с npm workspaces, strict typecheck и Vitest.
- [x] Зафиксированы ADR-001 baseline stack и ADR-002 multi-tenancy/authorization.
- [x] Созданы `TASKS.md` Sprint 0 и `docs/OPERATIONS.md` с bootstrap/runbook и явными непроверенными операционными шагами.
- [x] Создан локальный Docker Compose-конфиг PostgreSQL, Redis и MinIO; `docker compose config --quiet` проходит.
- [x] Реализован и покрыт тестами доменный `TenantContext`: active membership создаёт context, чужой tenant и неактивное membership отклоняются.
- [x] Реализован и покрыт тестами immutable `AuditEvent` factory с обязательными tenant, actor и subject.
- [x] Собран NestJS/Fastify API с liveness endpoint `GET /health`, покрытым HTTP-тестом.
- [x] Собран worker skeleton: handlers запускаются ровно один раз, останавливаются в обратном порядке; `SIGINT`/`SIGTERM` запускают graceful shutdown.
- [x] Добавлен typed configuration loader: обязательные service URLs и API port валидируются до запуска процессов.
- [x] Readiness endpoint `GET /ready` fail closed: без probes или при их ошибке возвращает `503`; поведение покрыто HTTP-тестами.
- [x] Prisma schema с составными tenant foreign keys валидна; Prisma Client генерируется успешно.
- [x] Создана initial SQL migration для identity/audit и scripts `migrate:dev`, `migrate:deploy`, `migrate:status`.
- [x] Initial migration содержит составные tenant foreign keys и DB-trigger, запрещающий `UPDATE`/`DELETE` для `audit_events`.
- [x] API создаёт `TenantContext` только из результата верифицированной сессии; tenant из client input не участвует в определении доступа.
- [x] Локальный Docker Compose запущен на закреплённых образах; PostgreSQL, Redis и MinIO прошли healthchecks.
- [x] Initial migration применена к чистой PostgreSQL; `migrate:status` подтверждает актуальную схему.
- [x] DB-интеграционные тесты подтверждают запрет cross-tenant role/audit actor links и прямого изменения audit event.
- [x] API `/ready` проверяет реальные PostgreSQL, Redis и MinIO; локальный HTTP-check с healthy dependencies вернул `200`.
- [x] Создан idempotent seed demo tenant «Кулиса» с synthetic admin identity; два запуска не создают дубликаты.
- [x] Scoped repositories для current identity/audit models получают tenant только из `TenantContext` для read/write/append.
- [x] Локальный password auth: scrypt credentials, opaque bearer tokens с SHA-256 hash в БД, active-membership verification и `POST /v1/auth/login` с `Cache-Control: no-store`.
- [x] Backend authorization guard fail closed: demo role `theatre_admin` получает тестовую permission `platform.admin`; HTTP `GET /v1/admin/session` проверяет verified session и permission через PostgreSQL.
- [x] E2E tenant isolation: admin tenant A получает `404` при read/rename role tenant B; роль не меняется, тогда как admin tenant B выполняет rename с одним audit event.
- [x] Database-only backup/restore drill: 20 KB synthetic PostgreSQL snapshot восстановлен в изолированную БД за 2 секунды, сущности и 2 migration сверены, временные артефакты удалены.
- [x] Пройдены текущие проверки: 40 unit/API-тестов, 11 DB-backed integration/E2E-тестов, `npm run typecheck`, `npm run build`.

> Не отмечены: единое правило repository scope, controlled initial-admin provisioning, MFA policy, scheduled encrypted off-host backup, object-storage restore и target RPO/RTO. Эти пункты требуют отдельных доказательств.

## 1. Неподвижные правила платформы

- Все tenant-owned записи содержат `tenant_id`. API извлекает tenant только из проверенной membership текущего пользователя; `tenant_id` из body, query и client state не принимается как источник полномочий.
- Авторизация и permission checks выполняются в API. UI может скрывать действие, но не является границей безопасности.
- Суммы хранятся в PostgreSQL `numeric`, в TypeScript передаются строкой или decimal-типом; `number` не используется для финансовых расчётов.
- Каждое изменение сметы, задачи, этапа, согласования, договора, акта и финансовой записи создаёт append-only `AuditEvent` с actor, временем, tenant, предметом, действием и структурированными изменениями.
- Доступ к файлу проверяется по связи файла с tenant-owned предметом, а не по угадываемому URL. Для скачивания выдаётся короткоживущая подписанная ссылка только после authz.
- Любой endpoint получает DTO validation, authentication, authorization, tenant isolation test, ошибку без утечки чужого существования (`404` либо согласованный `403`) и audit, если операция критична.
- Новый schema change идёт только Prisma/SQL migration. Миграция обратимо проверяется на пустой БД и на резервной копии staging-данных.
- Никаких интеграций с 1С, Диадок/СБИС, 44-ФЗ, Telegram; продаж билетов; HR/зарплаты; голосовых/видеозвонков; внешних чатов; миграции архивов прошлых лет в базовом объёме.

## 2. Карта поставки и границы модулей

| Инкремент | Недели | Результат, который можно принять |
| --- | --- | --- |
| 0. Обследование и фундамент | 1–2 | Подписанные правила, запускаемый контур, tenant isolation и аудит |
| 1. Идентичность и постановки | 3–4 | Пользователи, структура театра, спектакль и дашборд |
| 2. Сметы | 4–5 | Три представления сметы, расчёты, версии, Excel/PDF |
| 3. Задачи цехам | 5–7 | Утверждённая строка сметы создаёт задачу, включая мобильный сценарий |
| 4. Этапы и согласования | 8–9 | Доска постановки, согласование и индикатор здоровья |
| 5. Документы и паспорт | 10–12 | Договоры, акты, файлы, паспорт и восстановление резервной копии |
| 6. Репетиции | 13–16 | Календарь, занятость, конфликты и поиск свободных дат |
| 7. Репертуар и финансы | 17–20 | Показы, деньги, отчёты и весь текущий репертуар |
| 8. Визуальная смета | 21–23 | Граф сметы, альтернативы и работа на планшете |
| 9. Чаты | 24–26 | Контекстные чаты, уведомления, поиск и reconnect |

Целевые модули API: `identity`, `tenants`, `organization`, `productions`, `budgets`, `tasks`, `approvals`, `legal-documents`, `passport`, `files`, `scheduling`, `repertoire`, `finance`, `reports`, `notifications`, `chat`, `audit`, `export`, `admin`.

## 3. Инкремент 0 — обследование, решения и технический фундамент

### Результат

К концу недели 2 есть подписанный документ рабочих правил ТБДТ, утверждённые ADR-001 и ADR-002, запускаемые web/API/worker/инфраструктура, учебный tenant «Кулиса», тест межtenant-изоляции и неизменяемый audit foundation.

### Файлы и артефакты

- Создать `docs/adr/ADR-001-baseline-stack.md`: Next.js, NestJS, PostgreSQL, Redis, MinIO, BullMQ, Socket.IO, Docker Compose, Node LTS, package manager и политика версий.
- Создать `docs/adr/ADR-002-multi-tenancy-and-authorization.md`: tenant resolution, role/permission model, API policy, data access pattern, RLS decision, audit retention.
- Создать `docs/WORKSHOP_DISCOVERY.md`: согласованные роли, маршруты согласований, цеха, жизненные циклы, поля документов, правила здоровья, файловые лимиты и список исключений.
- Создать `docs/OPERATIONS.md`: окружения, переменные без секретов, backup/restore, обновление, мониторинг, incident contacts, RPO/RTO.
- Создать `TASKS.md` с первыми десятью небольшими задачами Sprint 0; после закрытия спринта заменить его следующим набором, а не смешивать задачи будущих этапов.
- Создать workspace-структуру из `docs/ARCHITECTURE.md`: `apps/web`, `apps/api`, `apps/worker`, `packages/ui`, `packages/db`, `packages/domain`, `packages/contracts`, `packages/auth`, `packages/config`, `packages/observability`, `infra/docker`.

### Шаги

- [ ] Провести отдельные 60–90-минутные сессии с продюсером, завпостом, начальниками пошивочного, гримёрного, бутафорского, светового и декорационного цехов, бухгалтерией и юристом.
- [ ] На одном ближайшем спектакле восстановить фактический путь: предварительная смета → подробная → утверждение → задача → перенос → согласование → договор/акт → паспорт → премьера.
- [ ] Зафиксировать и подписать матрицу `роль × действие × объект`; без неё не начинать финальные permissions.
- [ ] Зафиксировать конкретный набор карточек доски вместо предположения «100 шагов»; для каждой — owner, deadline policy, checklist, допустимые переходы и маршрут согласования.
- [ ] Зафиксировать алгоритм здоровья: события, делающие спектакль жёлтым/красным, и правило снятия индикатора. До подписания показывать нейтральный статус, а не придумывать пороги.
- [ ] Выбрать место пилотных живых данных, владельца сервера, ОС, CPU/RAM/disk, домен, TLS, почтовый relay, интернет-доступ, RPO/RTO и лимит файла. В документе указать ответственное лицо и дату решения до старта недели 3.
- [ ] Создать отдельные `development`, `demo/training`, `staging` окружения. Production-контур создаётся только после инфраструктурного решения; секреты хранятся в secret store/переменных окружения, не в Git.
- [x] Поднять PostgreSQL, Redis и MinIO через Docker Compose; добавить healthchecks, named volumes, least-privilege service accounts и локальный bootstrap script.
- [x] Создать API health/readiness endpoints: readiness проверяет соединения с PostgreSQL, Redis и MinIO без вывода DSN или ключей.
- [x] `RequestContext { requestId, userId, tenantId, membershipId }` реализован как `TenantContext` (`packages/domain/src/tenant-context.ts`, `createTenantContext`) и пробрасывается во все repository/service вызовы. Пробрасывается и в логирование: `apps/api/src/app.ts` — все 27 обработчиков контроллера переведены с `@Headers('authorization')` на `@Req() request: FastifyRequest`, `requirePlatformAdmin`/`session`/`adminSession` берут `authorization` и `requestId` из одного и того же реального Fastify `request.id` (`genReqId` теперь безусловный, не только при включённом логировании); Fastify per-request pino logger (`requestLogging` опция, включена в `main.ts`, выключена по умолчанию в тестах) с редактированием `authorization`/`cookie` заголовков. Тестом подтверждено, что `requestId` в ответе `GET /v1/session` совпадает с `reqId` в реальной лог-строке того же запроса — то есть это больше не два независимых `randomUUID()`. Полный набор тестов (175/175, включая integration/E2E) и `npm run build` перепроверены на чистой Postgres после рефакторинга всех 27 обработчиков.
- [x] Реализован единый repository scope как ESLint boundary rule: `eslint.config.mjs` — все Postgres*Repository/Resolver классы (`packages/db/src/postgres-*.ts`) уже принимают `context: TenantContext` первым параметром, кастомное правило `repo-boundaries/repository-scope` теперь запрещает добавлять новый unscoped метод (проверено — искусственно испорченный метод без `context` ловится правилом, затем откачен). Добавлены `eslint`/`typescript-eslint` как новые devDependencies (`npm install`, не затронуло существующие prisma/mysql2 pre-existing high-severity advisories — они не новые и не в scope этой задачи), `npm run lint` в `.github/workflows/ci.yml` перед остальными шагами. По ходу lint нашёл и починил один реальный code smell (`apps/api/src/readiness.ts`: тернарник-как-стейтмент → if/else). Repository методы, не входящие в API (устаревшие `createXRepository`-фабрики в `audit-event-repository.ts`/`membership-repository.ts`/`role-repository.ts`, нигде не импортируемые из `main.ts`/`app.ts` кроме их собственных тестов), правилом не покрыты — они не задействованы в реальном пути данных.
- [x] Таблицы `Tenant`, `User`, `Membership`, `Role`, `Permission`, `AuditEvent` реализованы (`packages/db/prisma/schema.prisma`, initial migration); demo tenant «Кулиса» с синтетическим `demo@demo.ru` создаётся идемпотентно через `seed:demo` (`packages/db/src/seed-demo.ts`) — перепроверено этой сессией на чистой scratch-БД.
- [x] Аудит через транзакционную запись реализован везде одним паттерном: mutation и `AuditEvent` — один атомарный многошаговый CTE-запрос (`INSERT ... RETURNING`, затем `INSERT INTO audit_events ... FROM <previous CTE>`), а не отдельные `BEGIN`/`COMMIT` вызовы из кода; ноль строк на любом шаге → ноль audit-событий. Перепроверено полным прогоном тестов на чистой Postgres.
- [x] Integration tests на tenant isolation существуют, хоть и не как один сводный файл: per-entity («rejects X outside/from another tenant») — в `postgres-organization-repository`, `postgres-budget-repository`, `postgres-production-repository`, `postgres-workshop-repository`, `postgres-membership-repository` integration-тестах; forged/cross-tenant на уровне DB constraints — в `tenant-integrity.integration.test.ts`; admin tenant A не читает/не переименовывает role tenant B (404, без изменения записи) — в `tenant-isolation.e2e.test.ts`. Все прогнаны на реальной Postgres этой сессией (175/175).
- [x] Проверить migration на чистом PostgreSQL, применить rollback procedure на копии базы и зафиксировать команды в `docs/OPERATIONS.md` (раздел «Migrations»): все 6 текущих migration применены на чистой scratch-БД, dump seeded staging-copy восстановлен после симулированного `DROP DATABASE` за 3.2 сек с полным совпадением counts и identity-данных.

### Приёмка

- [x] `docker compose up` поднимает все зависимости и healthchecks становятся healthy.
- [x] Пользователь demo tenant входит, видит responsive shell и не может открыть данные другого tenant: проверено реальным браузером (headless Chromium) через реальный веб + API + свежемигрированный Postgres — логин `demo@demo.ru`/`demo` через настоящую `/api/session` → `/v1/auth/login`, дашборд рендерится на desktop (1280px) и mobile (390px) вьюпортах, обращение к несуществующему/чужому id постановки показывает «Постановка не найдена» без утечки данных.
- [x] Mutation создаёт один business audit event; failed mutation не создаёт «успешный» audit event: подтверждено полным прогоном тестов (175/175, включая ранее пропускавшиеся integration/E2E) на чистой свежемигрированной Postgres — паттерн везде один (mutation + audit INSERT в одном атомарном CTE-запросе, `FROM created`/`FROM updated`, ноль строк при неуспехе → ноль audit-событий), явно проверено в org-unit/workshop-task/budget integration-тестах и в workshop-task-workflow E2E (6 audit-событий на полный жизненный цикл задачи).
- [x] CI выполняет lint, typecheck, unit и integration tests на чистой БД: `.github/workflows/ci.yml` теперь запускает `npm run lint` (ESLint, см. repository scope выше) перед `validate`/`migrate:deploy`/`npm test`/`test:integration`/`typecheck`/`build`; Postgres service container обеспечивает чистую БД. Локально перепроверено все то же самое (lint, typecheck, 175/175 тестов, build) на отдельной свежемигрированной scratch-БД.

## 4. Инкремент 1 — пользователи, оргструктура и постановки

### Контракт данных

`OrgUnit` содержит `id`, `tenant_id`, `parent_id`, `name`, `type`, `manager_membership_id`, `is_active`. `EmployeeProfile` содержит `membership_id`, должность, привязку к подразделениям и признак участия в труппе. `Production` содержит `id`, `tenant_id`, `title`, `status`, `premiere_date`, `producer_membership_id`, `health_status`, `health_reason`, `created_at`, `updated_at`.

### Шаги

- [x] Написать migration для `OrgUnit`, `EmployeeProfile`, `Workshop`, `Production` и `ProductionHealthEvent`; добавить индексы `(tenant_id, id)`, `(tenant_id, status)` и уникальности, согласованные в discovery.
- [x] Реализовать org-unit tree API с проверкой, что `parent_id` принадлежит тому же tenant и не образует цикл.
- [x] Реализовать перемещение org-unit (смена `parent_id`) с проверкой, что новый `parent_id` не создаёт цикл в дереве текущего tenant (`PATCH /v1/organization/org-units/:orgUnitId/move`, `PostgresOrganizationRepository.moveOrgUnit` — recursive-CTE ancestor check, `OrgUnitCycleError` 400, кросс-tenant `parentId` → `OrgUnitParentNotFoundError` 400, чужой org unit → 404, audit event `org_unit.moved` с old/new parent).
- [x] Реализовать membership management только для роли theatre admin; удаления заменять деактивацией, чтобы не разрушить историю и audit.
- [x] Реализовать назначение руководителя цеха: `manager_membership_id` уже был в схеме `Workshop`, но нигде не выставлялся — добавлены `managerMembershipId` в `POST /v1/organization/workshops` (опционально при создании) и `PATCH /v1/organization/workshops/:workshopId/manager` (назначить/сменить/снять через `null`), с проверкой, что membership принадлежит tenant (`WorkshopManagerNotFoundError` → 400), 404 для чужого цеха, audit event `workshop.manager_assigned`. UI создания цехов сознательно ещё не существует (см. `/workshops`: «Цеха создаются через API — UI создания появится позже») — назначение руководителя пока тоже только через API, тем же путём.
- [x] Реализовать CRUD спектакля: название, статус, плановая премьера, продюсер; создание автоматически делает audit event.
- [ ] Реализовать dashboard «все постановки»: карточка показывает название, текущий этап, deadline ближайшего риска и health indicator; причины отображаются только пользователям с доступом к постановке.
- [x] Добавить responsive views: desktop dashboard (сетка карточек), tablet/mobile список (одна колонка), клик/переход по названию открывает `/productions/[id]`. `:focus-visible` на всех интерактивных элементах, семантические `<table>`/`<a>`/`<button>` вместо кастомных виджетов.
- [ ] Написать API и browser E2E: theatre admin создаёт цех/спектакль; workshop manager видит только назначенные объекты; viewer/auditor не создаёт и не изменяет записи.

### Приёмка

- [x] Администратор настраивает пять цехов и назначает руководителей без изменения записей другого tenant: подтверждено integration-тестами (`postgres-workshop-repository.integration.test.ts`) — создание с менеджером своего tenant, отказ для менеджера чужого tenant без создания цеха, назначение/смена/снятие менеджера с audit event на каждое действие, 404 при попытке назначить менеджера цеху другого tenant.
- [ ] Продюсер создаёт спектакль и видит его на dashboard: подтверждено вживую (реальный логин через браузер → `POST /v1/productions` через реальный API → дашборд показывает карточку, донат-график статусов, счётчики) — на реальной, свежемигрированной и засеянной demo-БД. «Наблюдатель открывает только разрешённую информацию» — не подтверждено и не может быть: в системе функционально одна роль (`platform.admin`), viewer/observer роли нет (см. связанные пункты про role/approval матрицу).
- [x] История не теряется при деактивации сотрудника или подразделения: membership (сотрудник) деактивация уже существовала (`status = 'INACTIVE'`, строка и audit event сохраняются, `listMemberships` не фильтрует по статусу); добавлена деактивация org unit (подразделения) той же идемпотентной схемой — `DELETE /v1/organization/org-units/:orgUnitId` → `is_active = false`, audit event `org_unit.deactivated`, повторная деактивация возвращает 404 без дублирующего события, `listOrgUnits` показывает неактивные записи. Отдельная сущность `EmployeeProfile` (должность/признак труппы из контракта данных Инкремента 1) API ещё не имеет вообще — деактивация относится к Membership, который сейчас и есть фактическая identity-запись сотрудника.

## 5. Инкремент 2 — сметы и экспорт

### Контракт данных

`Budget` принадлежит спектаклю и хранит состояние `PRELIMINARY | DETAILED | APPROVED`. `BudgetVersion` неизменяемо фиксирует revision. `BudgetSection` принадлежит версии и цеху. `BudgetItem` хранит description, quantity, unit, `unit_price_numeric`, `total_numeric`, workshop, approval metadata. Итоги всегда вычисляются сервером из строк.

### Шаги

- [x] Создать migrations для `Budget`, `BudgetVersion`, `BudgetSection`, `BudgetItem`; зафиксировать precision/scale в ADR-001 (деньги `numeric(14,2)`, количество `numeric(12,3)`).
- [ ] Создать migration для `BudgetTemplate`; понадобится к Инкременту 8 (библиотека типовых карточек), сейчас не используется — отложено, а не забыто.
- [x] Реализовать сервис расчёта строки: `total = quantity × unit_price`; суммы разделов и сметы агрегируются на API (`packages/domain/src/money.ts`, BigInt fixed-point, round-half-up), не передаются доверенно из клиента.
- [x] Создать API создания сметы и черновой версии (`POST /v1/productions/:productionId/budgets`, `GET /v1/budgets/:budgetId`): первая версия сметы (revision 1) создаётся атомарно с разделами/строками, итоги всегда пересчитываются сервером.
- [x] Реализовать переход сметы в approved: `POST /v1/budgets/:budgetId/approve` — one-way (PRELIMINARY/DETAILED → APPROVED), повторный approve отклоняется (409), audit event `budget.approved`. Это разблокировало Инкремент 3 (задача создаётся только из approved-позиции).
- [x] Реализован edit-workflow: `POST /v1/budgets/:budgetId/revisions` (`PostgresBudgetRepository.createBudgetRevision`) создаёт новую `BudgetVersion` (revision+1) с новыми sections/items, не трогая ни одну строку предыдущих ревизий — approved snapshot остаётся неизменным навсегда, доступным по своему `revision`. Инженерное решение (не бизнес-правило): если текущий статус был `APPROVED`, новая ревизия переводит бюджет в `DETAILED` (снова требует `approveBudget`); если бюджет ещё не был утверждён (`PRELIMINARY`/`DETAILED`), статус не трогается — просто заменяется черновой контент. Та же tenant-scope проверка воркшопов, что и при создании; audit event `budget.revised` с номером ревизии. Проверено: 5 новых integration-тестов (иммутабельность revision 1 после ревизии, сохранение статуса для неутверждённого бюджета, audit event, отказ для чужого workshop без создания версии, 404 вне tenant) + HTTP-тесты, и вживую через реальный браузер+API+Postgres — создание→утверждение→ревизия с реальными деньгами, `budget-view.tsx` корректно показывает «Ревизия 2» и статус «Подробная».
- [x] Реализовать три UI-представления сметы по статусу (`apps/web/app/productions/[id]/budget-view.tsx`): PRELIMINARY — сводка по разделам без построчной таблицы, DETAILED/APPROVED — полная построчная таблица, APPROVED дополнительно показывает пометку «утверждена и не редактируется»; фильтр по цеху (dropdown, виден при >1 цехе в смете) и итог — сделаны и проверены в браузере (headless Chromium, скриншоты) с mock-данными двух статусов. История версий — по-прежнему не отображается в UI (`budget-view.tsx` показывает только текущую ревизию), хотя данные для неё теперь реально есть: edit-workflow (см. ниже) создаёт настоящие множественные ревизии в `budget_versions`, проверено вживую (revision 1 → 2 с разным содержимым). UI списка истории — отдельный, ещё не сделанный шаг.
- [x] Добавить server validation: quantity неотрицательное (`readNonNegativeDecimal`, scale 3), цена неотрицательная (scale 2), section/workshop того же tenant (`BudgetSectionWorkshopNotFoundError`); currency-поля в модели нет — валюта одна имплицитно, смешивать нечего.
- [ ] Реализовать экспорт через worker: запрос создаёт job, worker генерирует Excel/PDF из конкретной версии, сохраняет `FileAsset`, API возвращает статус; повторный запрос не блокирует HTTP request.
- [ ] Написать unit tests decimal-расчётов и округлений (есть — `money.test.ts`, rounding integration-тест), integration tests tenant scope (есть — во всех budget/org-unit/workshop integration-тестах) и immutability approved version (есть — `createBudgetRevision` тест), E2E создания/редактирования/экспорта сметы: создание и редактирование (ревизия) подтверждены вживую через реальный браузер+API+Postgres; экспорт не сделан вообще (см. следующий шаг, зависит от `FileAsset`/worker из Инкремента 5) — из-за него пункт остаётся открытым целиком.

### Приёмка

- [ ] Изменение количества или цены сразу показывает серверный итог без потери точности.
- [x] Утверждённую версию нельзя изменить; можно создать следующую версию с audit trail: подтверждено integration-тестом и вживую — после `createBudgetRevision` строки revision 1 (`budget_items`/`budget_sections` для этой ревизии) в БД остаются побайтово теми же, новая ревизия — отдельные строки с audit event `budget.revised`.
- [ ] Excel и PDF отражают одни и те же строки, итоги и версию.

## 6. Инкремент 3 — задачи цехам и первая рабочая очередь

### Контракт данных

`WorkshopTask` содержит `budget_item_id?`, `production_id`, `workshop_id`, `assignee_membership_id?`, `status`, `deadline_at`, `completed_at`, `description`. `TaskDeadlineChange` содержит старый/новый срок, обязательный `reason`, автора и время. Связь approved budget item → task должна быть уникальной, если discovery не утвердит явное разбиение.

> Предложение из `plan/idea.md` (визуальный конструктор, Инкремент 8): задача может иметь нескольких исполнителей одновременно, у каждого — свой статус выполнения (`TaskAssignee`: `task_id`, `membership_id`, `status`, `completed_at`), а начальник цеха принимает/отклоняет задачу целиком по совокупности. Это расширяет текущий контракт с одиночного `assignee_membership_id?` до массива исполнителей. Не начинать без подтверждения в `docs/OPEN_QUESTIONS.md` — влияет на role/approval матрицу и на то, как согласованная сумма Инкремента 8 считается из принятых задач.

### Шаги

- [x] Создать migration `WorkshopTask` с уникальным индексом `(tenant_id, budget_item_id)` на согласованную связь строки сметы и задачи (Postgres не считает несколько `NULL` конфликтующими — задачи без привязки к смете индексу не мешают).
- [x] Создать migration `TaskDeadlineChange`. `TaskAttachment` — понадобится для mobile-экрана с фото ниже, ещё не создана.
- [x] Реализовать command «создать задачу из утверждённой позиции» (`POST /v1/budget-items/:budgetItemId/tasks`): проверяет approved state сметы (`WorkshopTaskBudgetNotApprovedError` → 400), workshop берётся из раздела сметы (не вводится отдельно), отсутствие дубликата (`WorkshopTaskAlreadyExistsError` → 409), создаёт задачу и audit event. Доступ — тот же `platform.admin`, что и везде в проекте (нет отдельного "доступ продюсера" — роль/approval матрица ещё не согласована, см. `docs/OPEN_QUESTIONS.md`).
- [x] Список задач цеха: `GET /v1/organization/workshops/:workshopId/tasks` — базовый список без фильтров (фильтры «мои/срок/просрочено/статус» и mobile-экран — отдельный шаг ниже, ещё не сделан).
- [x] Реализовать lifecycle задачи: `new → assigned → accepted → completed → closed` (`PATCH .../assign`, `POST .../accept`, `.../complete`, `.../close`). Каждый переход проверяет текущий status (неверный переход → 409 `WorkshopTaskInvalidTransitionError`) и tenant (чужая задача → 404); каждый — отдельное audit-событие. Проверка actor role — тот же общий `platform.admin`, что и везде (нет отдельной проверки «именно назначенный исполнитель нажал принять» — для этого нужна ролевая матрица за пределами единственного текущего demo-пользователя).
- [x] Реализовать перенос срока (`PATCH /v1/workshop-tasks/:taskId/deadline`): endpoint отклоняет пустой/пробельный reason и запросы без ключа `deadlineAt` (400), пишет `TaskDeadlineChange` (старый/новый срок, reason, автор) и audit event атомарно, отклоняет перенос у `closed`-задачи (409 `WorkshopTaskClosedError`). Health event при согласованном пороге — не создаётся: `ProductionHealthService` и порог ещё не существуют (Инкремент 4, алгоритм не утверждён — см. `docs/OPEN_QUESTIONS.md`).
- [x] Добавить список задач цеха с фильтрами «мои», «срок», «просрочено», «статус» (`apps/web/app/workshops/[id]/task-board.tsx`, `currentMembershipId` из `GET /v1/session`). Mobile-first экран принятия/закрытия задачи с фото/файлом — ещё не сделан (нужен `TaskAttachment`, см. Инкремент 3 контракт данных). Базовый веб-UI уже есть (`/workshops`, `/workshops/:id`): список цехов, список задач цеха с реальными действиями «Назначить/Принять/Выполнено/Закрыть/Перенести срок» через `/api/proxy/*` (прокси до API с httpOnly-сессией, без exposed токена в браузере).
- [ ] Реализовать уведомление назначенному сотруднику через очередь; задача остаётся созданной, если отправка временно не удалась, а worker повторяет доставку с idempotency key.
- [x] Написать E2E (`apps/api/src/workshop-task-workflow.e2e.test.ts`, реальный Postgres + реальный HTTP через `createApiApp`): создание задачи из позиции до approve сметы → 400; approve → создание задачи → назначение исполнителя → приём → перенос без причины → 400 → перенос с причиной → 200 → выполнение → закрытие; проверены все 6 audit-событий по задаче.

### Контрольная точка недели 7

- [ ] Продюсер ведёт смету, цех получает задачу на компьютере, планшете и телефоне.
- [ ] Проверены роли, tenant isolation, audit, недоступность дубликата задачи и причины переноса.
- [ ] Проведено обучение продюсера, завпоста и начальников цехов; зафиксированы только подтверждённые замечания пилота.

## 7. Инкремент 4 — доска этапов, согласования и здоровье спектакля

### Контракт данных

`ProductionStage`, `StageCard`, `StageChecklistItem` описывают конфигурируемую доску. `Approval` хранит subject type/id, status, submitted_by, current_step. `ApprovalStep` хранит порядковый номер, назначенного reviewer и решение `PENDING | APPROVED | REJECTED | RETURNED` с обязательным комментарием для reject/return.

### Шаги

- [ ] Создать migrations доски и согласований; индексы по `(tenant_id, production_id, position)` и subject.
- [ ] Реализовать настройку этапов из подписанного discovery list, без зашитого «100 шагов».
- [ ] Реализовать CRUD карточки: ответственный, срок, checklist, вложения, позиция. Перемещение карточки проверяет допустимый transition.
- [ ] Реализовать отправку карточки/запроса в approval chain; решение разрешено только назначенному шагу и только один раз.
- [ ] Реализовать return с замечанием и повторную отправку; не удалять предыдущие решения, а формировать новую попытку с явной связью.
- [ ] Реализовать `ProductionHealthService`: принимает нормализованные события deadline/approval, применяет только подписанный алгоритм, сохраняет `ProductionHealthEvent`, выдаёт reason для dashboard.
- [ ] Написать integration tests конкурентного решения одного approval step, отказа неавторизованному reviewer, возврата с замечанием и изменения health indicator.

### Приёмка

- [ ] Карточка проходит утверждённую цепочку; отклонение возвращает её с замечанием и отображается как риск.
- [ ] Продюсер открывает спектакль и понимает, почему статус не зелёный.

## 8. Инкремент 5 — договоры, акты, паспорт, файлы и резервное копирование

### Контракт данных

`Contract` и `Act` имеют статусы, утверждённые в discovery, и ссылки на спектакль/контрагента. `AccountingHandoff` фиксирует готовность и передачу в бухгалтерию. `Passport` агрегирует неизменяемые `PassportEntry`; `FileAsset`/`MediaAsset` содержат tenant_id, owner type/id, object key, content type, size, checksum, uploaded_by.

### Шаги

- [ ] Создать migrations legal-documents, passport и assets; foreign keys не допускают cross-tenant links.
- [ ] Реализовать upload flow: API выдаёт scoped upload intent; после загрузки worker проверяет размер, allowlist type, checksum и связывает asset с объектом; неподтверждённый объект не публикуется в UI.
- [ ] Реализовать договоры и акты с согласованным status machine; completed task допускается к accounting handoff только при требуемых данных.
- [ ] Реализовать passport projector в worker: из audit, versions, approvals, закрытых задач и медиа строятся entries с source reference; projector идемпотентен и не меняет первичный источник.
- [ ] Реализовать экран паспорта с фильтрами по этапу/цеху/типу события и экспортом единого PDF; PDF generation выполняется асинхронно.
- [ ] Настроить ежедневный encrypted backup PostgreSQL и object storage inventory; хранить backup отдельно от рабочей VM/volume.
- [ ] Выполнить restore drill в чистом staging-контуре: восстановить БД и файлы, войти demo-пользователем, сверить checksum и случайную выборку паспорта. Записать фактические RPO/RTO.
- [ ] Написать E2E: задача закрыта → акт/передача → passport entry; файл другого tenant недоступен; экспорт паспорта не раскрывает удалённые/неразрешённые файлы.

### Контрольная точка недели 12

- [ ] Выбранный спектакль доведён от сметы до премьеры в системе.
- [ ] Паспорт, Excel/PDF-выгрузки и процедура восстановления приняты театром.

## 9. Инкремент 6 — труппа, помещения и репетиционный календарь

### Контракт данных

`Artist`, `ArtistAvailability`, `LeavePeriod`, `VenueRoom`, `Rehearsal`, `RehearsalParticipant` принадлежат tenant. Временные интервалы хранятся с timezone театра. Участник не может иметь пересекающиеся подтверждённые репетиции, а помещение — пересекающиеся бронирования.

### Шаги

- [ ] Создать migrations scheduling entities и диапазонные/прикладные constraints конфликтов, совместимые с PostgreSQL выбранной версии.
- [ ] Реализовать master data труппы и залов, а также ввод отпусков/больничных только ролями, определёнными в матрице.
- [ ] Реализовать create/update rehearsal API в транзакции: проверяет cast, room, availability и конфликты до записи.
- [ ] Реализовать API поиска свободного окна: вход — длительность, диапазон дат, состав, допустимые залы; выход — отсортированные windows и причины исключения.
- [ ] Реализовать календарь с drag/drop переносом, confirm-dialog и тем же server conflict check; нельзя считать client-side проверку окончательной.
- [ ] Связать примерку, монтировку и прогон с workshop tasks; изменения репетиции создают уведомление участников через очередь.
- [ ] Написать тесты двух пересекающихся запросов, отпусков, смены часового пояса, одного свободного окна и notification retry; добавить browser E2E на desktop/tablet/mobile.

### Приёмка

- [ ] Система не сохраняет репетицию с занятым артистом или залом и объясняет конфликт.
- [ ] Продюсер находит дату, когда весь выбранный состав свободен.

## 10. Инкремент 7 — репертуар, показы, деньги и отчёты

### Контракт данных

`Performance` связан со спектаклем, датой и площадкой. `PerformanceRevenue` и `PerformanceExpense` содержат `amount_numeric`, date, category, reference и audit metadata. Финансовый результат — серверная агрегация доходов минус расходов без денормализованного доверенного поля.

### Шаги

- [ ] Создать migrations repertoire и finance; индексы для production/date/category reports.
- [ ] Реализовать перенос остальных идущих спектаклей через валидируемый импорт-шаблон с preview и ошибками по строкам; не выполнять историческую миграцию вне согласованного объёма.
- [ ] Реализовать CRUD показов, сборов и расходов с role checks accounting/producer и immutable audit.
- [ ] Реализовать отчёты: результат одного спектакля, сравнение спектаклей, объём/стоимость работ цехов. Каждый отчёт ограничен tenant и доступен только разрешённым ролям.
- [ ] Запускать тяжёлые отчёты/экспорты worker-ом и кэшировать только tenant-scoped result с invalidation после mutation.
- [ ] Написать unit tests numeric aggregation, integration tests filters/permissions/tenant leakage, E2E «показ → сбор → расход → результат».
- [ ] Провести обучение остальных отделов и выпустить role-based инструкции в `docs/user-guides/`; зафиксировать исправления, подтверждённые пилотной работой.

### Контрольная точка недели 20

- [ ] В системе есть весь согласованный текущий репертуар; репетиции не допускают накладок; результат спектакля считается из введённых операций.

## 11. Инкремент 8 — визуальный конструктор сметы

### Контракт данных

`BudgetGraphNode` хранит `budget_version_id`, `parent_id?`, `node_type`, title, numeric amounts, position, dimensions и source template. `BudgetGraphEdge` выражает валидную directed связь. `BudgetAlternative` связывает взаимоисключающие ветви; в расчёт активной версии входит только выбранная ветвь.

> Продуктовое видение из `plan/idea.md`, отражённое здесь для единого понимания (не всё ниже подтверждено discovery — см. пометки):
> - Каждый узел уровня «цех/отдел» хранит **запланированную сумму** (вводится вручную ответственным) и показывает **согласованную сумму** — server-computed сумму `WorkshopTask`, принятых начальником цеха (тот же multi-assignee `WorkshopTask` из Инкремента 3, см. пометку там).
> - Клик по узлу открывает drill-down: шапка узла (название + суммы), список задач цеха с карточками (исполнители, индивидуальный статус каждого, кнопки «Принято»/«Отклонено» у начальника цеха). Именно нажатие «Принято» добавляет `total` задачи в согласованную сумму узла — это и есть `WorkshopTask` lifecycle из Инкремента 3, отображённый на канвасе, а не отдельная сущность.
> - Роли повторяют общую role/approval матрицу (`docs/OPEN_QUESTIONS.md`): admin/продюсер видит весь canvas и создаёт узлы, начальник цеха работает только в своём узле, сотрудник видит и закрывает только свои задачи.
> - Предложенная (не подтверждённая) цветовая индикация узла: сумма принятых задач больше плана → красный (перерасход), меньше → зелёный (экономия), равна → синий (точное соответствие). Требует discovery-подтверждения допуска на «точное соответствие» и того, отдельный ли это индикатор от `productions.health_status` — см. `docs/OPEN_QUESTIONS.md`.

### Шаги

- [ ] Создать migration graph entities и серверные constraints: node/version/edge одного tenant, нет self-edge, нет cycle, разрешены только уровни «production → workshop → work → material».
- [ ] Реализовать graph commands: create node, move/resize, connect, delete, copy branch, activate alternative, create version. Каждая команда получает expected revision для optimistic concurrency.
- [ ] Реализовать server calculation graph: обход от листьев к production, детекция цикла, сравнение двух версий/ветвей, сериализация результатов decimal-safe; агрегация согласованной суммы узла из принятых `WorkshopTask` (см. контракт выше).
- [ ] Реализовать canvas UI с pan/zoom, keyboard navigation, touch target не менее 44px, accessible textual outline и fallback table view.
- [ ] Реализовать drill-down узла: список задач цеха, карточка задачи с исполнителями и их статусами, действия «Принято»/«Отклонено» для начальника цеха — переиспользуя `WorkshopTask` command, не дублируя lifecycle.
- [ ] Реализовать библиотеку типовых карточек из `BudgetTemplate`; создание задачи доступно только для approved node и проходит тот же `WorkshopTask` command, что табличная смета.
- [ ] Реализовать (после discovery-подтверждения) цветовую индикацию узла по разнице плановой и согласованной суммы; до подтверждения — нейтральный индикатор, без изобретённых порогов.
- [ ] Написать tests cycle rejection, branch copy isolation, alternative switching, concurrent revision conflict, decimal totals и tablet interaction E2E.

### Приёмка

- [ ] Пользователь собирает ветку «спектакль → цех → работа → материалы», видит сумму и сравнивает дорогой/экономный вариант.
- [ ] Конструктор работает пальцем на планшете, а утверждённый элемент создаёт цеховую задачу без дубликата.
- [ ] Начальник цеха принимает задачу прямо из узла на канвасе, и согласованная сумма узла обновляется без повторного похода в табличную смету.

## 12. Инкремент 9 — чаты, уведомления и поиск

### Контракт данных

`Chat` имеет scope `PRODUCTION | WORKSHOP | DIRECT | CONTEXTUAL`; `ChatMember` задаёт доступ. `Message` содержит body, sender, created_at, edited/deleted audit metadata. `MessageAttachment` и `MessageMention` связаны с message. Contextual chat хранит subject type/id и открывается только при доступе к subject.

### Шаги

- [ ] Создать migrations chat entities, полнотекстовые индексы и scoped unique constraints; не создавать чат дубль для одного subject.
- [ ] Реализовать серверное создание production/workshop/contextual chat при создании subject, membership sync при изменении доступа и direct chat только между членами одного tenant.
- [ ] Реализовать message API: membership check, content length/type validation, attachment authorization, mention resolution только в пределах tenant; critical moderation/delete actions auditируются.
- [ ] Реализовать Socket.IO gateway, который проверяет session/membership при connect и subscribe, выдаёт события только chat members; после reconnect клиент получает missed events из DB cursor.
- [ ] Реализовать unread counters на сервере, browser/email notifications через outbox/worker с idempotency key и пользовательскими настройками уведомлений.
- [ ] Реализовать поиск с tenant/chat scope, пагинацией и permission filtering; результат не выдаёт содержимое чата, к которому пользователь потерял доступ.
- [ ] Реализовать UI: production/workshop/direct chats, тред или contextual panel на задаче/согласовании/узле сметы, упоминания, вложения, unread, mobile camera upload.
- [ ] Написать tests socket unauthorized subscribe, reconnect cursor, удаление доступа, mention notification once, поиск с cross-chat restriction и mobile E2E.

### Контрольная точка недели 26

- [ ] Чаты, обсуждения и уведомления работают для согласованных 150 пользователей без раскрытия чужих данных.
- [ ] Исходный код, runbooks, ADR, user guides и перечень third-party licences переданы театру.

## 13. Общая проверка, выпуск и сопровождение

- [ ] На каждом pull request выполнять lint, typecheck, unit, integration и затронутые E2E; блокировать merge при critical/blocker findings.
- [ ] Перед каждой контрольной точкой провести product QA по acceptance из `docs/ACCEPTANCE.md`, security review authz/tenant/files, accessibility review и responsive visual QA на desktop, tablet, mobile.
- [ ] Перед пилотом провести threat model: tenant breakout, IDOR, forged upload, privilege escalation, audit tampering, WebSocket unauthorized subscription, export disclosure, queue retry duplication.
- [ ] Перед production провести load test на согласованном числе активных пользователей и файлов, restore drill, backup monitoring, проверку TLS, secret rotation procedure и rollback deployment.
- [ ] Каждые две недели демонстрировать завершённый вертикальный сценарий; замечания в согласованном scope исправлять в текущем этапе, изменение scope оформлять отдельно.
- [ ] После Stage 02 предоставить три месяца поддержки: triage, исправление дефектов, контроль бэкапов и ответы отделам. Новые интеграции и функции вести отдельными задачами/соглашениями.

## 14. Матрица трассировки приёмки

| Acceptance | Инкременты |
| --- | --- |
| A. Auth, tenant context, audit, org, productions | 0–1 |
| B. Три сметы, задачи, перенос со причиной, mobile | 2–3 |
| C. Доска, approvals, health, passport, export | 4–5 |
| D. Репетиции, конфликты, свободные даты | 6 |
| E. Показы, деньги, сравнение | 7 |
| F. Визуальная смета, альтернативы, tablet | 8 |
| G. Контекстные чаты, mentions, unread, search, reconnect | 9 |

## 15. Условия начала и стоп-сигналы

- Не начинать разработку бизнес-правила, если его решение отсутствует в `docs/WORKSHOP_DISCOVERY.md`; сначала получить письменное решение и обновить соответствующий ADR/spec.
- Не принимать Stage 01 без теста восстановления и без живого сквозного сценария выбранного спектакля.
- Не загружать реальные персональные данные в облако до принятия инфраструктурного решения, соглашения об обработке данных и проверки доступа.
- Не заменять проверку API проверкой UI; не обходить migration, audit или tenant scope ради срока.
- Не включать список будущих интеграций в backlog базовой поставки без отдельного scope, оценки и security review.
