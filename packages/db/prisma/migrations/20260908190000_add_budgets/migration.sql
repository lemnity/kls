CREATE TYPE "BudgetStatus" AS ENUM ('PRELIMINARY', 'DETAILED', 'APPROVED');

CREATE TABLE "budgets" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "production_id" UUID NOT NULL,
  "status" "BudgetStatus" NOT NULL DEFAULT 'PRELIMINARY',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "budget_versions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_membership_id" UUID NOT NULL,
  CONSTRAINT "budget_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "budget_versions_revision_positive" CHECK ("revision" > 0)
);

CREATE TABLE "budget_sections" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "budget_version_id" UUID NOT NULL,
  "workshop_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "budget_sections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "budget_sections_title_not_blank" CHECK (length(btrim("title")) > 0)
);

CREATE TABLE "budget_items" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "budget_section_id" UUID NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL,
  "unit" VARCHAR(50) NOT NULL,
  "unit_price" DECIMAL(14,2) NOT NULL,
  "total" DECIMAL(14,2) NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "budget_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "budget_items_description_not_blank" CHECK (length(btrim("description")) > 0),
  CONSTRAINT "budget_items_unit_not_blank" CHECK (length(btrim("unit")) > 0),
  CONSTRAINT "budget_items_quantity_non_negative" CHECK ("quantity" >= 0),
  CONSTRAINT "budget_items_unit_price_non_negative" CHECK ("unit_price" >= 0),
  CONSTRAINT "budget_items_total_non_negative" CHECK ("total" >= 0)
);

CREATE UNIQUE INDEX "budgets_tenant_id_production_id_key" ON "budgets"("tenant_id", "production_id");
CREATE UNIQUE INDEX "budgets_tenant_id_id_key" ON "budgets"("tenant_id", "id");

CREATE UNIQUE INDEX "budget_versions_tenant_id_budget_id_revision_key" ON "budget_versions"("tenant_id", "budget_id", "revision");
CREATE UNIQUE INDEX "budget_versions_tenant_id_id_key" ON "budget_versions"("tenant_id", "id");

CREATE UNIQUE INDEX "budget_sections_tenant_id_id_key" ON "budget_sections"("tenant_id", "id");
CREATE INDEX "budget_sections_tenant_id_budget_version_id_idx" ON "budget_sections"("tenant_id", "budget_version_id");

CREATE UNIQUE INDEX "budget_items_tenant_id_id_key" ON "budget_items"("tenant_id", "id");
CREATE INDEX "budget_items_tenant_id_budget_section_id_idx" ON "budget_items"("tenant_id", "budget_section_id");

ALTER TABLE "budgets" ADD CONSTRAINT "budgets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_tenant_id_production_id_fkey" FOREIGN KEY ("tenant_id", "production_id") REFERENCES "productions"("tenant_id", "id") ON DELETE RESTRICT;

ALTER TABLE "budget_versions" ADD CONSTRAINT "budget_versions_tenant_id_budget_id_fkey" FOREIGN KEY ("tenant_id", "budget_id") REFERENCES "budgets"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "budget_versions" ADD CONSTRAINT "budget_versions_tenant_id_created_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "created_by_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT;

ALTER TABLE "budget_sections" ADD CONSTRAINT "budget_sections_tenant_id_budget_version_id_fkey" FOREIGN KEY ("tenant_id", "budget_version_id") REFERENCES "budget_versions"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "budget_sections" ADD CONSTRAINT "budget_sections_tenant_id_workshop_id_fkey" FOREIGN KEY ("tenant_id", "workshop_id") REFERENCES "workshops"("tenant_id", "id") ON DELETE RESTRICT;

ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_tenant_id_budget_section_id_fkey" FOREIGN KEY ("tenant_id", "budget_section_id") REFERENCES "budget_sections"("tenant_id", "id") ON DELETE RESTRICT;
