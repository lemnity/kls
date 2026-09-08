CREATE TABLE "budget_graph_nodes" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "budget_version_id" UUID NOT NULL,
  "parent_id" UUID,
  "workshop_id" UUID,
  "node_type" VARCHAR(20) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "planned_amount" DECIMAL(14,2) NOT NULL,
  "position_x" DECIMAL(10,2) NOT NULL,
  "position_y" DECIMAL(10,2) NOT NULL,
  "width" DECIMAL(10,2) NOT NULL,
  "height" DECIMAL(10,2) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "budget_graph_nodes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "budget_graph_nodes_title_not_blank" CHECK (length(btrim("title")) > 0),
  CONSTRAINT "budget_graph_nodes_node_type_valid" CHECK ("node_type" IN ('production', 'workshop', 'work', 'material')),
  CONSTRAINT "budget_graph_nodes_not_self_parent" CHECK ("parent_id" IS NULL OR "parent_id" != "id"),
  CONSTRAINT "budget_graph_nodes_planned_amount_non_negative" CHECK ("planned_amount" >= 0)
);

CREATE UNIQUE INDEX "budget_graph_nodes_tenant_id_id_key" ON "budget_graph_nodes"("tenant_id", "id");
CREATE INDEX "budget_graph_nodes_tenant_id_budget_version_id_idx" ON "budget_graph_nodes"("tenant_id", "budget_version_id");
CREATE INDEX "budget_graph_nodes_tenant_id_parent_id_idx" ON "budget_graph_nodes"("tenant_id", "parent_id");

ALTER TABLE "budget_graph_nodes" ADD CONSTRAINT "budget_graph_nodes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
ALTER TABLE "budget_graph_nodes" ADD CONSTRAINT "budget_graph_nodes_tenant_id_budget_version_id_fkey" FOREIGN KEY ("tenant_id", "budget_version_id") REFERENCES "budget_versions"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "budget_graph_nodes" ADD CONSTRAINT "budget_graph_nodes_tenant_id_parent_id_fkey" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "budget_graph_nodes"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "budget_graph_nodes" ADD CONSTRAINT "budget_graph_nodes_tenant_id_workshop_id_fkey" FOREIGN KEY ("tenant_id", "workshop_id") REFERENCES "workshops"("tenant_id", "id") ON DELETE RESTRICT;
