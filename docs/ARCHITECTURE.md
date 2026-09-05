# Architecture

Modular monolith first.

## Monorepo
apps/web
apps/api
apps/worker
packages/ui
packages/db
packages/domain
packages/contracts
packages/auth
packages/config
packages/observability

## Backend modules
identity, tenants, organization, productions, budgets, workshops, tasks, approvals, legal-documents, passport, files, scheduling, repertoire, performances, finance, reports, notifications, chat, audit, export, admin.

## Infrastructure
PostgreSQL, Redis, MinIO, Docker Compose.

## Tenancy
Every tenant-owned entity has tenant_id. All backend data access uses tenant context. Cross-tenant access must fail closed.

## Audit
Append-only evidence, separate from comments/chat.

## Async
BullMQ for export, email, passport generation, reports and background processing.

## Realtime
Socket.IO/WebSocket for notifications/chat; DB remains source of truth.

## Deployment
First target: theatre on-prem server. Production + demo/training environments.
