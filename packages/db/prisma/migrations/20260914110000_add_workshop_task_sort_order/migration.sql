ALTER TABLE "workshop_tasks" ADD COLUMN "sort_order" NUMERIC(30,10) NOT NULL DEFAULT 0;

-- Backfill existing rows with a stable order derived from creation time,
-- scoped per graph node — classic budget-item tasks (graph_node_id IS NULL)
-- don't use this ordering feature yet, but a harmless default keeps every
-- row's value deterministic rather than leaving them all at the same 0.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY graph_node_id ORDER BY created_at ASC) AS rn
  FROM "workshop_tasks"
)
UPDATE "workshop_tasks" t
SET "sort_order" = ranked.rn
FROM ranked
WHERE t.id = ranked.id;

CREATE INDEX "workshop_tasks_tenant_id_graph_node_id_sort_order_idx"
  ON "workshop_tasks"("tenant_id", "graph_node_id", "sort_order");
