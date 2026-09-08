# Product Specification — Платформа КУЛИСА

## Product
Система, в которой театр ведет спектакль от первой сметы до денег в прокате.
Workflow: смета → задачи цехам → согласования → договоры/акты → паспорт спектакля → репетиции → прокат/деньги.

## Core users
 theatre_admin, general_manager, producer, head_of_production, workshop_manager, workshop_employee, legal, accounting, scheduler, artist, viewer/auditor.
Точная permission matrix уточняется на Sprint 0.

## Multi-tenancy
Данные театров строго разделены. Оргструктура и цеха настраиваются. Возможен demo tenant «Кулиса».

## Stage 01
- identity / organization / roles / hierarchy;
- productions + health indicator;
- budgets: preliminary, detailed, approved;
- budget items by workshops, totals, history, approved item → task, Excel/PDF export;
- workshop tasks: assignee, deadline, status, reschedule reason, attachments, history;
- production board and stage cards;
- approvals: send/approve/reject/return, chain, audit;
- contracts, acts, accounting handoff;
- production passport with budget changes, approvals, completed tasks, stages, media and documents;
- daily backup + restore procedure.

## Stage 02
- repertoire;
- rehearsal calendar by rooms/cast;
- conflict detection and free-date search;
- workshop-linked events and notifications;
- performances, gross revenue, expenses, result and reports.

## Stage 03
- visual budget builder: production → workshop → work → materials; canvas, links, alternatives, branch copy, version comparison, approved node → task, tablet support;
- internal chat: production/workshop/direct, contextual discussions, mentions, attachments, unread, browser/email notifications, search.

## Out of scope base
Ticket sales, auditorium, public poster, payroll/HR, voice/video, external chats, historic archive migration, server purchasing/hosting, 1C, Diadoc/SBIS, 44-FZ, Telegram, custom branding.
