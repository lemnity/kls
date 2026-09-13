ALTER TABLE "workshop_tasks" ADD COLUMN "start_at" TIMESTAMP(3);

ALTER TABLE "workshop_tasks" ADD CONSTRAINT "workshop_tasks_start_at_before_deadline"
  CHECK ("start_at" IS NULL OR "deadline_at" IS NULL OR "start_at" <= "deadline_at");
