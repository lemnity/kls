CREATE TABLE "workshop_tasks" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "budget_item_id" UUID,
  "production_id" UUID NOT NULL,
  "workshop_id" UUID NOT NULL,
  "assignee_membership_id" UUID,
  "status" VARCHAR(100) NOT NULL,
  "description" VARCHAR(1000) NOT NULL,
  "deadline_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workshop_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workshop_tasks_status_not_blank" CHECK (length(btrim("status")) > 0),
  CONSTRAINT "workshop_tasks_description_not_blank" CHECK (length(btrim("description")) > 0)
);

CREATE UNIQUE INDEX "workshop_tasks_tenant_id_id_key" ON "workshop_tasks"("tenant_id", "id");
CREATE UNIQUE INDEX "workshop_tasks_tenant_id_budget_item_id_key" ON "workshop_tasks"("tenant_id", "budget_item_id");
CREATE INDEX "workshop_tasks_tenant_id_production_id_idx" ON "workshop_tasks"("tenant_id", "production_id");
CREATE INDEX "workshop_tasks_tenant_id_workshop_id_idx" ON "workshop_tasks"("tenant_id", "workshop_id");
CREATE INDEX "workshop_tasks_tenant_id_status_idx" ON "workshop_tasks"("tenant_id", "status");

ALTER TABLE "workshop_tasks" ADD CONSTRAINT "workshop_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
ALTER TABLE "workshop_tasks" ADD CONSTRAINT "workshop_tasks_tenant_id_budget_item_id_fkey" FOREIGN KEY ("tenant_id", "budget_item_id") REFERENCES "budget_items"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "workshop_tasks" ADD CONSTRAINT "workshop_tasks_tenant_id_production_id_fkey" FOREIGN KEY ("tenant_id", "production_id") REFERENCES "productions"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "workshop_tasks" ADD CONSTRAINT "workshop_tasks_tenant_id_workshop_id_fkey" FOREIGN KEY ("tenant_id", "workshop_id") REFERENCES "workshops"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "workshop_tasks" ADD CONSTRAINT "workshop_tasks_tenant_id_assignee_membership_id_fkey" FOREIGN KEY ("tenant_id", "assignee_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT;
