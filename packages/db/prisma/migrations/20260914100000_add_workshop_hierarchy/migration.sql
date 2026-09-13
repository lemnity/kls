ALTER TABLE "workshops" ADD COLUMN "parent_workshop_id" UUID;

ALTER TABLE "workshops" ADD CONSTRAINT "workshops_parent_not_self"
  CHECK ("parent_workshop_id" IS NULL OR "parent_workshop_id" != "id");

CREATE INDEX "workshops_tenant_id_parent_workshop_id_idx" ON "workshops"("tenant_id", "parent_workshop_id");

ALTER TABLE "workshops" ADD CONSTRAINT "workshops_tenant_id_parent_workshop_id_fkey"
  FOREIGN KEY ("tenant_id", "parent_workshop_id") REFERENCES "workshops"("tenant_id", "id") ON DELETE RESTRICT;
