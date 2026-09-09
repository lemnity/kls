ALTER TABLE "workshop_tasks" ADD COLUMN "graph_node_id" UUID;
ALTER TABLE "workshop_tasks" ADD COLUMN "planned_amount" DECIMAL(14,2);
ALTER TABLE "workshop_tasks" ADD CONSTRAINT "workshop_tasks_planned_amount_non_negative" CHECK ("planned_amount" IS NULL OR "planned_amount" >= 0);

CREATE INDEX "workshop_tasks_tenant_id_graph_node_id_idx" ON "workshop_tasks"("tenant_id", "graph_node_id");

ALTER TABLE "workshop_tasks" ADD CONSTRAINT "workshop_tasks_tenant_id_graph_node_id_fkey" FOREIGN KEY ("tenant_id", "graph_node_id") REFERENCES "budget_graph_nodes"("tenant_id", "id") ON DELETE RESTRICT;

CREATE TABLE "task_assignees" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_assignees_status_valid" CHECK ("status" IN ('pending', 'done'))
);

CREATE UNIQUE INDEX "task_assignees_tenant_id_id_key" ON "task_assignees"("tenant_id", "id");
CREATE UNIQUE INDEX "task_assignees_tenant_id_task_id_membership_id_key" ON "task_assignees"("tenant_id", "task_id", "membership_id");
CREATE INDEX "task_assignees_tenant_id_task_id_idx" ON "task_assignees"("tenant_id", "task_id");

ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_tenant_id_task_id_fkey" FOREIGN KEY ("tenant_id", "task_id") REFERENCES "workshop_tasks"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT;

CREATE TABLE "node_attachments" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "node_id" UUID NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "content_type" VARCHAR(150) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "object_key" VARCHAR(500) NOT NULL,
  "uploaded_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "node_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "node_attachments_file_name_not_blank" CHECK (length(btrim("file_name")) > 0),
  CONSTRAINT "node_attachments_object_key_not_blank" CHECK (length(btrim("object_key")) > 0),
  CONSTRAINT "node_attachments_size_bytes_non_negative" CHECK ("size_bytes" >= 0)
);

CREATE UNIQUE INDEX "node_attachments_tenant_id_id_key" ON "node_attachments"("tenant_id", "id");
CREATE INDEX "node_attachments_tenant_id_node_id_idx" ON "node_attachments"("tenant_id", "node_id");

ALTER TABLE "node_attachments" ADD CONSTRAINT "node_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
ALTER TABLE "node_attachments" ADD CONSTRAINT "node_attachments_tenant_id_node_id_fkey" FOREIGN KEY ("tenant_id", "node_id") REFERENCES "budget_graph_nodes"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "node_attachments" ADD CONSTRAINT "node_attachments_tenant_id_uploaded_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "uploaded_by_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT;
