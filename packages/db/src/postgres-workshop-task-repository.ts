import { randomUUID } from 'node:crypto';

import type { TenantContext } from '@kulisa/domain/tenant-context';
import type { Client } from 'pg';

type SqlClient = Pick<Client, 'query'>;

const DEFAULT_TASK_STATUS = 'new';

export interface StoredWorkshopTask {
  id: string;
  budgetItemId: string | null;
  graphNodeId: string | null;
  productionId: string;
  workshopId: string;
  assigneeMembershipId: string | null;
  status: string;
  description: string;
  plannedAmount: string | null;
  deadlineAt: string | null;
  completedAt: string | null;
}

export interface CreateTaskFromBudgetItemInput {
  budgetItemId: string;
  description?: string;
  assigneeMembershipId?: string;
  deadlineAt?: string;
}

export interface CreateTaskForGraphNodeInput {
  description: string;
  plannedAmount: string;
  assigneeMembershipIds: string[];
  deadlineAt?: string;
}

export type TaskAssigneeStatus = 'pending' | 'done';
export type TaskLeadDecision = 'approved' | 'rejected';

export interface StoredTaskAssignee {
  membershipId: string;
  displayName: string;
  status: TaskAssigneeStatus;
  completedAt: string | null;
}

export interface StoredWorkshopTaskWithAssignees extends StoredWorkshopTask {
  assignees: StoredTaskAssignee[];
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

export class WorkshopTaskInvalidTransitionError extends Error {
  public constructor(
    public readonly taskId: string,
    public readonly expectedStatus: string,
    public readonly actualStatus: string,
  ) {
    super(`Task ${taskId} is '${actualStatus}', expected '${expectedStatus}' for this transition`);
    this.name = 'WorkshopTaskInvalidTransitionError';
  }
}

export class WorkshopTaskClosedError extends Error {
  public constructor(public readonly taskId: string) {
    super(`Task ${taskId} is closed and cannot be modified`);
    this.name = 'WorkshopTaskClosedError';
  }
}

export class WorkshopTaskGraphNodeNotFoundError extends Error {
  public constructor(public readonly graphNodeId: string) {
    super(`Budget graph node ${graphNodeId} not found in tenant`);
    this.name = 'WorkshopTaskGraphNodeNotFoundError';
  }
}

export class WorkshopTaskGraphNodeNotWorkshopError extends Error {
  public constructor(public readonly graphNodeId: string) {
    super(`Budget graph node ${graphNodeId} is not a workshop node with a linked workshop`);
    this.name = 'WorkshopTaskGraphNodeNotWorkshopError';
  }
}

export class WorkshopTaskAlreadyDecidedError extends Error {
  public constructor(public readonly taskId: string, public readonly status: string) {
    super(`Task ${taskId} already has a lead decision ('${status}')`);
    this.name = 'WorkshopTaskAlreadyDecidedError';
  }
}

const TASK_RAW_COLUMNS = `id, budget_item_id, graph_node_id, production_id, workshop_id,
           assignee_membership_id, status, description, planned_amount, deadline_at, completed_at`;
const TASK_COLUMNS = `id, budget_item_id AS "budgetItemId", graph_node_id AS "graphNodeId",
           production_id AS "productionId", workshop_id AS "workshopId",
           assignee_membership_id AS "assigneeMembershipId",
           status, description, planned_amount AS "plannedAmount",
           to_char(deadline_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "deadlineAt",
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
         RETURNING ${TASK_RAW_COLUMNS}
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

  /**
   * Инкремент 8 drill-down: a task created directly against a `workshop`-type
   * budget graph node, not tied to a legacy `budget_item`. Multiple assignees
   * each get their own `task_assignees` row; the task itself stays in status
   * 'new' until the workshop lead records a whole-task decision
   * (`recordLeadDecision`) — assignee sub-statuses never drive `status`.
   */
  public async createTaskForGraphNode(
    context: TenantContext,
    graphNodeId: string,
    input: CreateTaskForGraphNodeInput,
  ): Promise<StoredWorkshopTaskWithAssignees> {
    const node = await this.client.query<{ nodeType: string; workshopId: string | null; productionId: string }>(
      `SELECT n.node_type AS "nodeType", n.workshop_id AS "workshopId", b.production_id AS "productionId"
       FROM budget_graph_nodes n
       JOIN budget_versions bv ON bv.tenant_id = n.tenant_id AND bv.id = n.budget_version_id
       JOIN budgets b ON b.tenant_id = bv.tenant_id AND b.id = bv.budget_id
       WHERE n.id = $1 AND n.tenant_id = $2`,
      [graphNodeId, context.tenantId],
    );
    const source = node.rows[0];
    if (!source) throw new WorkshopTaskGraphNodeNotFoundError(graphNodeId);
    if (source.nodeType !== 'workshop' || !source.workshopId) {
      throw new WorkshopTaskGraphNodeNotWorkshopError(graphNodeId);
    }

    const found = await this.client.query<{ id: string }>(
      'SELECT id FROM memberships WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
      [context.tenantId, input.assigneeMembershipIds],
    );
    const foundIds = new Set(found.rows.map((row) => row.id));
    const missing = input.assigneeMembershipIds.find((id) => !foundIds.has(id));
    if (missing) throw new WorkshopTaskAssigneeNotFoundError(missing);

    const taskId = randomUUID();
    const assigneeRowIds = input.assigneeMembershipIds.map(() => randomUUID());
    const result = await this.client.query<StoredWorkshopTask>(
      `WITH created AS (
         INSERT INTO workshop_tasks (
           id, tenant_id, budget_item_id, graph_node_id, production_id, workshop_id,
           assignee_membership_id, status, description, planned_amount, deadline_at, updated_at
         )
         VALUES ($1, $2, NULL, $3, $4, $5, NULL, $6, $7, $8::numeric, $9::timestamptz, NOW())
         RETURNING ${TASK_RAW_COLUMNS}
       ), assignees_inserted AS (
         INSERT INTO task_assignees (id, tenant_id, task_id, membership_id, status)
         SELECT row_id, $2, $1, membership_id, 'pending'
         FROM unnest($10::uuid[], $11::uuid[]) AS t(row_id, membership_id)
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $12, $2, $13, 'workshop_task.created', 'workshop_task', id,
           jsonb_build_object('graphNodeId', $3, 'plannedAmount', $8::numeric)
         FROM created
       )
       SELECT ${TASK_COLUMNS} FROM created`,
      [
        taskId,
        context.tenantId,
        graphNodeId,
        source.productionId,
        source.workshopId,
        DEFAULT_TASK_STATUS,
        input.description,
        input.plannedAmount,
        input.deadlineAt ?? null,
        assigneeRowIds,
        input.assigneeMembershipIds,
        randomUUID(),
        context.membershipId,
      ],
    );

    return { ...result.rows[0]!, assignees: await this.listAssignees(context, taskId) };
  }

  public async listGraphNodeTasks(
    context: TenantContext,
    graphNodeId: string,
  ): Promise<StoredWorkshopTaskWithAssignees[]> {
    const result = await this.client.query<StoredWorkshopTask>(
      `SELECT ${TASK_COLUMNS}
       FROM workshop_tasks
       WHERE tenant_id = $1 AND graph_node_id = $2
       ORDER BY created_at ASC`,
      [context.tenantId, graphNodeId],
    );

    const tasks = result.rows;
    if (tasks.length === 0) return [];

    const assignees = await this.client.query<{ taskId: string } & StoredTaskAssignee>(
      `SELECT ta.task_id AS "taskId", ta.membership_id AS "membershipId", u."displayName" AS "displayName",
              ta.status, to_char(ta.completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "completedAt"
       FROM task_assignees ta
       JOIN memberships m ON m.tenant_id = ta.tenant_id AND m.id = ta.membership_id
       JOIN users u ON u.id = m.user_id
       WHERE ta.tenant_id = $1 AND ta.task_id = ANY($2::uuid[])
       ORDER BY u."displayName" ASC`,
      [context.tenantId, tasks.map((task) => task.id)],
    );
    const byTask = new Map<string, StoredTaskAssignee[]>();
    for (const row of assignees.rows) {
      const list = byTask.get(row.taskId) ?? [];
      list.push({ membershipId: row.membershipId, displayName: row.displayName, status: row.status, completedAt: row.completedAt });
      byTask.set(row.taskId, list);
    }

    return tasks.map((task) => ({ ...task, assignees: byTask.get(task.id) ?? [] }));
  }

  private async listAssignees(context: TenantContext, taskId: string): Promise<StoredTaskAssignee[]> {
    const result = await this.client.query<StoredTaskAssignee>(
      `SELECT ta.membership_id AS "membershipId", u."displayName" AS "displayName",
              ta.status, to_char(ta.completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "completedAt"
       FROM task_assignees ta
       JOIN memberships m ON m.tenant_id = ta.tenant_id AND m.id = ta.membership_id
       JOIN users u ON u.id = m.user_id
       WHERE ta.tenant_id = $1 AND ta.task_id = $2
       ORDER BY u."displayName" ASC`,
      [context.tenantId, taskId],
    );
    return result.rows;
  }

  public async markAssigneeDone(
    context: TenantContext,
    taskId: string,
    membershipId: string,
  ): Promise<StoredTaskAssignee | null> {
    const task = await this.client.query<{ status: string }>(
      'SELECT status FROM workshop_tasks WHERE id = $1 AND tenant_id = $2',
      [taskId, context.tenantId],
    );
    const current = task.rows[0];
    if (!current) return null;
    if (current.status === 'approved' || current.status === 'rejected') {
      throw new WorkshopTaskAlreadyDecidedError(taskId, current.status);
    }

    const result = await this.client.query<{ id: string }>(
      `WITH updated AS (
         UPDATE task_assignees
         SET status = 'done', completed_at = NOW()
         WHERE tenant_id = $1 AND task_id = $2 AND membership_id = $3
         RETURNING id
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $4, $1, $5, 'workshop_task.assignee_marked_done', 'workshop_task', $2,
           jsonb_build_object('membershipId', $3)
         FROM updated
       )
       SELECT id FROM updated`,
      [context.tenantId, taskId, membershipId, randomUUID(), context.membershipId],
    );
    if (result.rows.length === 0) throw new WorkshopTaskAssigneeNotFoundError(membershipId);

    const assignees = await this.listAssignees(context, taskId);
    return assignees.find((assignee) => assignee.membershipId === membershipId) ?? null;
  }

  public async recordLeadDecision(
    context: TenantContext,
    taskId: string,
    decision: TaskLeadDecision,
  ): Promise<StoredWorkshopTaskWithAssignees | null> {
    const current = await this.requireCurrentStatus(context, taskId, 'new');
    if (current === null) return null;

    const result = await this.client.query<StoredWorkshopTask>(
      `WITH updated AS (
         UPDATE workshop_tasks
         SET status = $3::varchar, completed_at = CASE WHEN $3::varchar = 'approved' THEN NOW() ELSE completed_at END,
             updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING ${TASK_RAW_COLUMNS}
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $4, $2, $5, 'workshop_task.lead_decision', 'workshop_task', id,
           jsonb_build_object('decision', $3::varchar)
         FROM updated
       )
       SELECT ${TASK_COLUMNS} FROM updated`,
      [taskId, context.tenantId, decision, randomUUID(), context.membershipId],
    );

    return { ...result.rows[0]!, assignees: await this.listAssignees(context, taskId) };
  }

  public async assignTask(
    context: TenantContext,
    taskId: string,
    assigneeMembershipId: string,
  ): Promise<StoredWorkshopTask | null> {
    const current = await this.requireCurrentStatus(context, taskId, 'new');
    if (current === null) return null;

    const assignee = await this.client.query(
      'SELECT 1 FROM memberships WHERE id = $1 AND tenant_id = $2',
      [assigneeMembershipId, context.tenantId],
    );
    if ((assignee.rowCount ?? 0) === 0) throw new WorkshopTaskAssigneeNotFoundError(assigneeMembershipId);

    const result = await this.client.query<StoredWorkshopTask>(
      `WITH updated AS (
         UPDATE workshop_tasks
         SET status = 'assigned', assignee_membership_id = $3, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING ${TASK_RAW_COLUMNS}
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $4, $2, $5, 'workshop_task.assigned', 'workshop_task', id, '{}'::jsonb
         FROM updated
       )
       SELECT ${TASK_COLUMNS} FROM updated`,
      [taskId, context.tenantId, assigneeMembershipId, randomUUID(), context.membershipId],
    );

    return result.rows[0]!;
  }

  public async acceptTask(context: TenantContext, taskId: string): Promise<StoredWorkshopTask | null> {
    const current = await this.requireCurrentStatus(context, taskId, 'assigned');
    if (current === null) return null;

    const result = await this.client.query<StoredWorkshopTask>(
      `WITH updated AS (
         UPDATE workshop_tasks
         SET status = 'accepted', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING ${TASK_RAW_COLUMNS}
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $3, $2, $4, 'workshop_task.accepted', 'workshop_task', id, '{}'::jsonb
         FROM updated
       )
       SELECT ${TASK_COLUMNS} FROM updated`,
      [taskId, context.tenantId, randomUUID(), context.membershipId],
    );

    return result.rows[0]!;
  }

  public async completeTask(context: TenantContext, taskId: string): Promise<StoredWorkshopTask | null> {
    const current = await this.requireCurrentStatus(context, taskId, 'accepted');
    if (current === null) return null;

    const result = await this.client.query<StoredWorkshopTask>(
      `WITH updated AS (
         UPDATE workshop_tasks
         SET status = 'completed', completed_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING ${TASK_RAW_COLUMNS}
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $3, $2, $4, 'workshop_task.completed', 'workshop_task', id, '{}'::jsonb
         FROM updated
       )
       SELECT ${TASK_COLUMNS} FROM updated`,
      [taskId, context.tenantId, randomUUID(), context.membershipId],
    );

    return result.rows[0]!;
  }

  public async closeTask(context: TenantContext, taskId: string): Promise<StoredWorkshopTask | null> {
    const current = await this.requireCurrentStatus(context, taskId, 'completed');
    if (current === null) return null;

    const result = await this.client.query<StoredWorkshopTask>(
      `WITH updated AS (
         UPDATE workshop_tasks
         SET status = 'closed', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING ${TASK_RAW_COLUMNS}
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $3, $2, $4, 'workshop_task.closed', 'workshop_task', id, '{}'::jsonb
         FROM updated
       )
       SELECT ${TASK_COLUMNS} FROM updated`,
      [taskId, context.tenantId, randomUUID(), context.membershipId],
    );

    return result.rows[0]!;
  }

  public async rescheduleTaskDeadline(
    context: TenantContext,
    taskId: string,
    newDeadlineAt: string | null,
    reason: string,
  ): Promise<StoredWorkshopTask | null> {
    const existing = await this.client.query<{ status: string }>(
      'SELECT status FROM workshop_tasks WHERE id = $1 AND tenant_id = $2',
      [taskId, context.tenantId],
    );
    const current = existing.rows[0];
    if (!current) return null;
    if (current.status === 'closed') throw new WorkshopTaskClosedError(taskId);

    const result = await this.client.query<StoredWorkshopTask>(
      `WITH updated AS (
         UPDATE workshop_tasks
         SET deadline_at = $3::timestamptz, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING ${TASK_RAW_COLUMNS}
       ), change_logged AS (
         INSERT INTO task_deadline_changes (
           id, tenant_id, workshop_task_id, old_deadline_at, new_deadline_at, reason, actor_membership_id
         )
         SELECT $6, $2, $1, t.deadline_at, updated.deadline_at, $4, $5
         FROM workshop_tasks t, updated
         WHERE t.id = $1 AND t.tenant_id = $2
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $7, $2, $5, 'workshop_task.deadline_changed', 'workshop_task', id,
           jsonb_build_object('reason', $4)
         FROM updated
       )
       SELECT ${TASK_COLUMNS} FROM updated`,
      [taskId, context.tenantId, newDeadlineAt, reason, context.membershipId, randomUUID(), randomUUID()],
    );

    return result.rows[0]!;
  }

  private async requireCurrentStatus(
    context: TenantContext,
    taskId: string,
    expectedStatus: string,
  ): Promise<string | null> {
    const result = await this.client.query<{ status: string }>(
      'SELECT status FROM workshop_tasks WHERE id = $1 AND tenant_id = $2',
      [taskId, context.tenantId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.status !== expectedStatus) {
      throw new WorkshopTaskInvalidTransitionError(taskId, expectedStatus, row.status);
    }
    return row.status;
  }
}
