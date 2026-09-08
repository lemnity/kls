CREATE TABLE "task_deadline_changes" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "workshop_task_id" UUID NOT NULL,
  "old_deadline_at" TIMESTAMP(3),
  "new_deadline_at" TIMESTAMP(3),
  "reason" VARCHAR(500) NOT NULL,
  "actor_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_deadline_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_deadline_changes_reason_not_blank" CHECK (length(btrim("reason")) > 0)
);

CREATE UNIQUE INDEX "task_deadline_changes_tenant_id_id_key" ON "task_deadline_changes"("tenant_id", "id");
CREATE INDEX "task_deadline_changes_tenant_id_workshop_task_id_idx" ON "task_deadline_changes"("tenant_id", "workshop_task_id");

ALTER TABLE "task_deadline_changes" ADD CONSTRAINT "task_deadline_changes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
ALTER TABLE "task_deadline_changes" ADD CONSTRAINT "task_deadline_changes_tenant_id_workshop_task_id_fkey" FOREIGN KEY ("tenant_id", "workshop_task_id") REFERENCES "workshop_tasks"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "task_deadline_changes" ADD CONSTRAINT "task_deadline_changes_tenant_id_actor_membership_id_fkey" FOREIGN KEY ("tenant_id", "actor_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT;
