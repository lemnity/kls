# Платформа КУЛИСА

Система управления театральной постановкой — от первой сметы до денег в прокате.

**Основной поток:** смета → задачи цехам → согласования → договоры и акты → паспорт спектакля → репетиции → прокат и деньги.

## Что уже есть (Stage 01)

- организации, роли, иерархия, мультитенантность (данные театров строго разделены);
- постановки с индикатором здоровья проекта;
- сметы: предварительная → детальная → согласованная, статьи по цехам, история изменений, экспорт в Excel/PDF;
- задачи цехам: исполнитель, дедлайн, статус, перенос сроков с причиной, вложения, история;
- доска постановки и карточки этапов;
- согласования: отправка/принятие/отклонение/возврат, цепочка, аудит;
- договоры, акты, передача в бухгалтерию;
- паспорт спектакля: изменения сметы, согласования, завершённые задачи, этапы, медиа и документы.

**Дальше по плану:** репертуар и календарь репетиций (Stage 02), визуальный конструктор сметы и внутренний чат (Stage 03) — детали в [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) и [docs/ROADMAP.md](docs/ROADMAP.md).

## Технологии

Монорепозиторий на npm workspaces:

| | |
|---|---|
| `apps/web` | Next.js (App Router) — клиент |
| `apps/api` | NestJS + Fastify — backend |
| `apps/worker` | фоновые задачи (BullMQ) |
| `packages/db` | Prisma (схема/миграции) + репозитории на raw `pg` |
| `packages/domain` | доменная модель |
| `packages/auth` | аутентификация/авторизация |
| `packages/config` | конфигурация |

Инфраструктура: PostgreSQL, Redis, MinIO, Docker Compose. Подробности — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Документация

- [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) — продуктовая спецификация
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — архитектура
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — модель данных
- [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) — критерии приёмки
- [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) — локальный запуск
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — эксплуатация
- [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) — открытые вопросы

## Для контрибьюторов

Начинать в Cursor по `prompts/cursor/00-FIRST_RUN.md`. Все продуктовые и архитектурные решения — в `docs/`. Переход на Codex — по `prompts/codex/HANDOFF.md`, без переписывания.

```bash
npm install
npm run lint && npm run typecheck && npm test
```
