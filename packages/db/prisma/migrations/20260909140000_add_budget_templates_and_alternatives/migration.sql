ALTER TABLE "budget_graph_nodes" ADD COLUMN "alternative_group_id" UUID;
ALTER TABLE "budget_graph_nodes" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "budget_graph_nodes_tenant_id_alternative_group_id_idx" ON "budget_graph_nodes"("tenant_id", "alternative_group_id");

CREATE TABLE "budget_templates" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "node_type" VARCHAR(20) NOT NULL,
  "planned_amount" DECIMAL(14,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "budget_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "budget_templates_name_not_blank" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "budget_templates_node_type_valid" CHECK ("node_type" IN ('production', 'workshop', 'work', 'material')),
  CONSTRAINT "budget_templates_planned_amount_non_negative" CHECK ("planned_amount" >= 0)
);

CREATE UNIQUE INDEX "budget_templates_tenant_id_id_key" ON "budget_templates"("tenant_id", "id");
CREATE INDEX "budget_templates_tenant_id_node_type_idx" ON "budget_templates"("tenant_id", "node_type");

ALTER TABLE "budget_templates" ADD CONSTRAINT "budget_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
