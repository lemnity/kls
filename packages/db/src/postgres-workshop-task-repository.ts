import { randomUUID } from 'node:crypto';

import type { TenantContext } from '@kulisa/domain/tenant-context';
import type { Client } from 'pg';

type SqlClient = Pick<Client, 'query'>;

const DEFAULT_TASK_STATUS = 'new';

export interface StoredWorkshopTask {
  id: string;
  budgetItemId: string | null;
  productionId: string;
  workshopId: string;
  assigneeMembershipId: string | null;
  status: string;
  description: string;
  deadlineAt: string | null;
  completedAt: string | null;
}

export interface CreateTaskFromBudgetItemInput {
  budgetItemId: string;
  description?: string;
  assigneeMembershipId?: string;
  deadlineAt?: string;
}

export class WorkshopTaskBudgetItemNotFoundError extends Error {
  public constructor(public readonly budgetItemId: string) {
    super(`Budget item ${budgetItemId} not found in tenant`);
    this.name = 'WorkshopTaskBudgetItemNotFoundError';
  }
}

export class WorkshopTaskBudgetNotApprovedError extends Error {
  public constructor(public readonly budgetItemId: string) {
    super(`Budget item ${budgetItemId} belongs to a budget that is not approved`);
    this.name = 'WorkshopTaskBudgetNotApprovedError';
  }
}

export class WorkshopTaskAlreadyExistsError extends Error {
  public constructor(public readonly budgetItemId: string) {
    super(`Budget item ${budgetItemId} already has a workshop task`);
    this.name = 'WorkshopTaskAlreadyExistsError';
  }
}

export class WorkshopTaskAssigneeNotFoundError extends Error {
  public constructor(public readonly assigneeMembershipId: string) {
    super(`Assignee membership ${assigneeMembershipId} not found in tenant`);
    this.name = 'WorkshopTaskAssigneeNotFoundError';
  }
}

const TASK_COLUMNS = `id, budget_item_id AS "budgetItemId", production_id AS "productionId",
           workshop_id AS "workshopId", assignee_membership_id AS "assigneeMembershipId",
           status, description, to_char(deadline_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "deadlineAt",
           to_char(completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "completedAt"`;

export class PostgresWorkshopTaskRepository {
  public constructor(private readonly client: SqlClient) {}

  public async createTaskFromBudgetItem(
    context: TenantContext,
    input: CreateTaskFromBudgetItemInput,
  ): Promise<StoredWorkshopTask> {
    const lookup = await this.client.query<{
      itemDescription: string;
      workshopId: string;
      productionId: string;
      budgetStatus: string;
    }>(
      `SELECT bi.description AS "itemDescription", bs.workshop_id AS "workshopId",
              b.production_id AS "productionId", b.status AS "budgetStatus"
       FROM budget_items bi
       JOIN budget_sections bs ON bs.tenant_id = bi.tenant_id AND bs.id = bi.budget_section_id
       JOIN budget_versions bv ON bv.tenant_id = bs.tenant_id AND bv.id = bs.budget_version_id
       JOIN budgets b ON b.tenant_id = bv.tenant_id AND b.id = bv.budget_id
       WHERE bi.id = $1 AND bi.tenant_id = $2`,
      [input.budgetItemId, context.tenantId],
    );
    const source = lookup.rows[0];
    if (!source) throw new WorkshopTaskBudgetItemNotFoundError(input.budgetItemId);
    if (source.budgetStatus !== 'APPROVED') throw new WorkshopTaskBudgetNotApprovedError(input.budgetItemId);

    const duplicate = await this.client.query(
      'SELECT 1 FROM workshop_tasks WHERE tenant_id = $1 AND budget_item_id = $2',
      [context.tenantId, input.budgetItemId],
    );
    if ((duplicate.rowCount ?? 0) > 0) throw new WorkshopTaskAlreadyExistsError(input.budgetItemId);

    if (input.assigneeMembershipId) {
      const assignee = await this.client.query(
        'SELECT 1 FROM memberships WHERE id = $1 AND tenant_id = $2',
        [input.assigneeMembershipId, context.tenantId],
      );
      if ((assignee.rowCount ?? 0) === 0) {
        throw new WorkshopTaskAssigneeNotFoundError(input.assigneeMembershipId);
      }
    }

    const taskId = randomUUID();
    const description = input.description ?? source.itemDescription;
    const result = await this.client.query<StoredWorkshopTask>(
      `WITH created AS (
         INSERT INTO workshop_tasks (
           id, tenant_id, budget_item_id, production_id, workshop_id,
           assignee_membership_id, status, description, deadline_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, NOW())
         RETURNING id, budget_item_id, production_id, workshop_id, assignee_membership_id,
           status, description, deadline_at, completed_at
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $10, $2, $11, 'workshop_task.created', 'workshop_task', id,
           jsonb_build_object('budgetItemId', $3, 'workshopId', $5)
         FROM created
       )
       SELECT ${TASK_COLUMNS} FROM created`,
      [
        taskId,
        context.tenantId,
        input.budgetItemId,
        source.productionId,
        source.workshopId,
        input.assigneeMembershipId ?? null,
        DEFAULT_TASK_STATUS,
        description,
        input.deadlineAt ?? null,
        randomUUID(),
        context.membershipId,
      ],
    );

    return result.rows[0]!;
  }

  public async listTasksByWorkshop(context: TenantContext, workshopId: string): Promise<StoredWorkshopTask[]> {
    const result = await this.client.query<StoredWorkshopTask>(
      `SELECT ${TASK_COLUMNS}
       FROM workshop_tasks
       WHERE tenant_id = $1 AND workshop_id = $2
       ORDER BY created_at ASC`,
      [context.tenantId, workshopId],
    );

    return result.rows;
  }
}
