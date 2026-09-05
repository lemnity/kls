CREATE TABLE "org_units" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "parent_id" UUID,
  "manager_membership_id" UUID,
  "name" VARCHAR(200) NOT NULL,
  "type" VARCHAR(100) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "org_units_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "org_units_type_not_blank" CHECK (length(btrim("type")) > 0)
);

CREATE TABLE "employee_profiles" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "is_artist" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employee_profile_org_units" (
  "tenant_id" UUID NOT NULL,
  "employee_profile_id" UUID NOT NULL,
  "org_unit_id" UUID NOT NULL,
  CONSTRAINT "employee_profile_org_units_pkey" PRIMARY KEY ("tenant_id", "employee_profile_id", "org_unit_id")
);

CREATE TABLE "workshops" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "org_unit_id" UUID,
  "manager_membership_id" UUID,
  "name" VARCHAR(200) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workshops_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "productions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "title" VARCHAR(300) NOT NULL,
  "status" VARCHAR(100) NOT NULL,
  "premiere_date" DATE,
  "producer_membership_id" UUID,
  "health_status" VARCHAR(100) NOT NULL,
  "health_reason" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "productions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "productions_status_not_blank" CHECK (length(btrim("status")) > 0),
  CONSTRAINT "productions_health_status_not_blank" CHECK (length(btrim("health_status")) > 0)
);

CREATE TABLE "production_health_events" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "production_id" UUID NOT NULL,
  "actor_membership_id" UUID NOT NULL,
  "health_status" VARCHAR(100) NOT NULL,
  "reason" VARCHAR(1000),
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_health_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_health_events_status_not_blank" CHECK (length(btrim("health_status")) > 0)
);

CREATE UNIQUE INDEX "org_units_tenant_id_id_key" ON "org_units"("tenant_id", "id");
CREATE INDEX "org_units_tenant_id_parent_id_idx" ON "org_units"("tenant_id", "parent_id");
CREATE INDEX "org_units_tenant_id_is_active_idx" ON "org_units"("tenant_id", "is_active");
CREATE UNIQUE INDEX "employee_profiles_tenant_id_membership_id_key" ON "employee_profiles"("tenant_id", "membership_id");
CREATE UNIQUE INDEX "employee_profiles_tenant_id_id_key" ON "employee_profiles"("tenant_id", "id");
CREATE INDEX "employee_profile_org_units_tenant_id_org_unit_id_idx" ON "employee_profile_org_units"("tenant_id", "org_unit_id");
CREATE UNIQUE INDEX "workshops_tenant_id_name_key" ON "workshops"("tenant_id", "name");
CREATE UNIQUE INDEX "workshops_tenant_id_id_key" ON "workshops"("tenant_id", "id");
CREATE INDEX "workshops_tenant_id_is_active_idx" ON "workshops"("tenant_id", "is_active");
CREATE UNIQUE INDEX "productions_tenant_id_id_key" ON "productions"("tenant_id", "id");
CREATE INDEX "productions_tenant_id_status_idx" ON "productions"("tenant_id", "status");
CREATE INDEX "productions_tenant_id_premiere_date_idx" ON "productions"("tenant_id", "premiere_date");
CREATE INDEX "production_health_events_tenant_id_production_id_occurred_at_idx" ON "production_health_events"("tenant_id", "production_id", "occurred_at");

ALTER TABLE "org_units" ADD CONSTRAINT "org_units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_tenant_id_parent_id_fkey" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "org_units"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_tenant_id_manager_membership_id_fkey" FOREIGN KEY ("tenant_id", "manager_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_profile_org_units" ADD CONSTRAINT "employee_profile_org_units_tenant_id_employee_profile_id_fkey" FOREIGN KEY ("tenant_id", "employee_profile_id") REFERENCES "employee_profiles"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employee_profile_org_units" ADD CONSTRAINT "employee_profile_org_units_tenant_id_org_unit_id_fkey" FOREIGN KEY ("tenant_id", "org_unit_id") REFERENCES "org_units"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_tenant_id_org_unit_id_fkey" FOREIGN KEY ("tenant_id", "org_unit_id") REFERENCES "org_units"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_tenant_id_manager_membership_id_fkey" FOREIGN KEY ("tenant_id", "manager_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "productions" ADD CONSTRAINT "productions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
ALTER TABLE "productions" ADD CONSTRAINT "productions_tenant_id_producer_membership_id_fkey" FOREIGN KEY ("tenant_id", "producer_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "production_health_events" ADD CONSTRAINT "production_health_events_tenant_id_production_id_fkey" FOREIGN KEY ("tenant_id", "production_id") REFERENCES "productions"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "production_health_events" ADD CONSTRAINT "production_health_events_tenant_id_actor_membership_id_fkey" FOREIGN KEY ("tenant_id", "actor_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT;
