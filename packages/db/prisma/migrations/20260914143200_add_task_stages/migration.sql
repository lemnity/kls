-- Classic (single-assignee) WorkshopTask lifecycle moves from a fixed
-- 5-value status enum to an arbitrary, user-extendable ordered list of
-- stages ("этапы"), each with its own status. Graph-node tasks
-- (graph_node_id IS NOT NULL) are a completely separate feature sharing
-- this same table and are untouched by every step below.

ALTER TABLE "workshop_tasks" ADD COLUMN "rejected_at" TIMESTAMP(3);

CREATE TABLE "task_stages" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "label" VARCHAR(200) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "sort_order" DECIMAL(30,10) NOT NULL,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "task_stages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_stages_label_not_blank" CHECK (length(btrim("label")) > 0),
  CONSTRAINT "task_stages_status_valid" CHECK ("status" IN ('pending', 'in_progress', 'done'))
);

CREATE UNIQUE INDEX "task_stages_tenant_id_id_key" ON "task_stages"("tenant_id", "id");
CREATE INDEX "task_stages_tenant_id_task_id_sort_order_idx" ON "task_stages"("tenant_id", "task_id", "sort_order");

ALTER TABLE "task_stages" ADD CONSTRAINT "task_stages_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_stages" ADD CONSTRAINT "task_stages_tenant_id_task_id_fkey"
  FOREIGN KEY ("tenant_id", "task_id") REFERENCES "workshop_tasks"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Fail loudly rather than mis-seed silently: every classic task's status
-- today is one of exactly these 5 literals (verified against the current
-- repository/API code before writing this migration). If that's no longer
-- true, the CASE below in the backfill would need updating first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "workshop_tasks"
    WHERE "graph_node_id" IS NULL
      AND "status" NOT IN ('new', 'assigned', 'accepted', 'completed', 'closed')
  ) THEN
    RAISE EXCEPTION 'Unexpected classic workshop_tasks.status value found before stage backfill';
  END IF;
END $$;

-- Seed the 5 legacy stages for every EXISTING classic task, with the stage
-- matching the task's current status marked in_progress, earlier ones
-- done, later ones pending — EXCEPT old status 'closed' (index 4, the
-- last stage): there is nothing left to advance to, so that stage itself
-- is 'done' too, matching the new model's "no stage stays in_progress once
-- the task is fully finished" invariant (see advanceTask). `stage_status`
-- is computed once and reused for started_at/completed_at so those two
-- columns can't drift out of sync with the status they describe.
-- gen_random_uuid() is a core Postgres 16 builtin (no extension needed) —
-- a one-off exception to this repo's "ids come from Node randomUUID()"
-- convention, since a hand-written backfill has no application code to
-- call into.
WITH classic_tasks AS (
  SELECT id, tenant_id, created_at, updated_at,
    CASE status
      WHEN 'new' THEN 0
      WHEN 'assigned' THEN 1
      WHEN 'accepted' THEN 2
      WHEN 'completed' THEN 3
      WHEN 'closed' THEN 4
    END AS current_index
  FROM "workshop_tasks"
  WHERE "graph_node_id" IS NULL
),
labels(idx, label) AS (
  VALUES (0, 'Новая'), (1, 'Назначена'), (2, 'Принята'), (3, 'Выполнена'), (4, 'Закрыта')
),
seeded AS (
  SELECT
    ct.tenant_id,
    ct.id AS task_id,
    l.label,
    l.idx,
    ct.created_at,
    ct.updated_at,
    CASE
      WHEN l.idx < ct.current_index THEN 'done'
      WHEN l.idx = ct.current_index AND ct.current_index = 4 THEN 'done'
      WHEN l.idx = ct.current_index THEN 'in_progress'
      ELSE 'pending'
    END AS stage_status
  FROM classic_tasks ct
  CROSS JOIN labels l
)
INSERT INTO "task_stages" (id, tenant_id, task_id, label, status, sort_order, started_at, completed_at, updated_at)
SELECT
  gen_random_uuid(),
  tenant_id,
  task_id,
  label,
  stage_status,
  idx + 1,
  CASE WHEN stage_status IN ('in_progress', 'done') THEN created_at ELSE NULL END,
  CASE WHEN stage_status = 'done' THEN updated_at ELSE NULL END,
  NOW()
FROM seeded;

-- workshop_tasks.completed_at was set (by the old completeTask transition)
-- the moment a task first reached old status 'completed' — i.e. it was set
-- when the task was only on stage index 3, one stage short of the end.
-- Under the new meaning ("every stage reached done") that's wrong unless
-- the task also went on to be 'closed' (index 4). Clear it for any classic
-- task that never made it to 'closed'.
UPDATE "workshop_tasks"
SET "completed_at" = NULL
WHERE "graph_node_id" IS NULL AND "status" = 'completed';

UPDATE "workshop_tasks" SET "status" = 'active' WHERE "graph_node_id" IS NULL;
