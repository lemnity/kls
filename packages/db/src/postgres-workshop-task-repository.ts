import { randomUUID } from 'node:crypto';

import type { TenantContext } from '@kulisa/domain/tenant-context';
import type { Client } from 'pg';

type SqlClient = Pick<Client, 'query'>;

// Graph-node task creation only — DO NOT reuse for classic tasks (see
// DEFAULT_CLASSIC_TASK_STATUS below). Sharing this constant's *value*
// between the two systems would silently break the untouched graph-node
// lead-decision flow, which requires a fresh task to start at 'new'.
const DEFAULT_TASK_STATUS = 'new';

// Classic (single-assignee) task creation only. Classic tasks no longer
// use the old 5-value status vocabulary — see TaskStage for the actual
// step-by-step progress, tracked in its own table.
const DEFAULT_CLASSIC_TASK_STATUS = 'active';

// Seeded onto every newly-created classic task, in order. Users may add
// further stages beyond these five, or rename any of them.
const DEFAULT_TASK_STAGE_LABELS = ['Новая', 'Назначена', 'Принята', 'Выполнена', 'Закрыта'] as const;

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
  startAt: string | null;
  deadlineAt: string | null;
  completedAt: string | null;
  /** Classic tasks only — terminal rejection, independent of stage
      progress. Always null for graph-node tasks (which use their own
      `status` value 'rejected' instead). */
  rejectedAt: string | null;
}

export type TaskStageStatus = 'pending' | 'in_progress' | 'done';

/** One ordered step ("этап") of a classic task's lifecycle. Graph-node
    tasks never have any TaskStage rows. */
export interface StoredTaskStage {
  id: string;
  taskId: string;
  label: string;
  status: TaskStageStatus;
  sortOrder: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface StoredWorkshopTaskWithStages extends StoredWorkshopTask {
  stages: StoredTaskStage[];
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
  /** Insert the new task's position right after this existing task on the
      same graph node, instead of appending at the end. */
  afterTaskId?: string;
}

export interface CreateTaskForWorkshopInput {
  productionId: string;
  workshopId: string;
  description: string;
  /** Defaults to `deadlineAt` when omitted — a single-day task spans just that one day. */
  startAt?: string;
  deadlineAt: string;
  assigneeMembershipId?: string;
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

export class WorkshopTaskAfterTaskNotFoundError extends Error {
  public constructor(public readonly afterTaskId: string) {
    super(`Task ${afterTaskId} to insert after not found on this graph node`);
    this.name = 'WorkshopTaskAfterTaskNotFoundError';
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

/** Classic tasks only — the task has been rejected (terminal) and cannot
    be assigned, rescheduled, advanced, reverted, or have its stages
    edited. Replaces the old WorkshopTaskClosedError, whose only guard
    (`status === 'closed'`) became permanently unreachable once classic
    tasks stopped using that status value — this is its direct successor,
    not an addition alongside it. */
export class WorkshopTaskRejectedError extends Error {
  public constructor(public readonly taskId: string) {
    super(`Task ${taskId} is rejected and cannot be modified`);
    this.name = 'WorkshopTaskRejectedError';
  }
}

export class WorkshopTaskAlreadyRejectedError extends Error {
  public constructor(public readonly taskId: string) {
    super(`Task ${taskId} is already rejected`);
    this.name = 'WorkshopTaskAlreadyRejectedError';
  }
}

/** advanceTask called after every stage is already done. */
export class WorkshopTaskAlreadyCompletedError extends Error {
  public constructor(public readonly taskId: string) {
    super(`Task ${taskId} has already completed every stage`);
    this.name = 'WorkshopTaskAlreadyCompletedError';
  }
}

export class WorkshopTaskNoActiveStageError extends Error {
  public constructor(public readonly taskId: string) {
    super(`Task ${taskId} has no stage currently in progress`);
    this.name = 'WorkshopTaskNoActiveStageError';
  }
}

/** revertTask called with nothing earlier to revert to — already at the first stage. */
export class WorkshopTaskNoPrecedingStageError extends Error {
  public constructor(public readonly taskId: string) {
    super(`Task ${taskId} has no earlier stage to revert to`);
    this.name = 'WorkshopTaskNoPrecedingStageError';
  }
}

export class WorkshopTaskStageNotFoundError extends Error {
  public constructor(public readonly stageId: string) {
    super(`Task stage ${stageId} not found on this task`);
    this.name = 'WorkshopTaskStageNotFoundError';
  }
}

/** Defense-in-depth: the stage endpoints (add/edit/advance/revert/reject)
    only make sense for classic tasks. No current UI path calls them with
    a graph-node task id, but they should refuse rather than silently
    operate on one if that ever happens. */
export class WorkshopTaskNotClassicError extends Error {
  public constructor(public readonly taskId: string) {
    super(`Task ${taskId} belongs to a graph node and has no stages`);
    this.name = 'WorkshopTaskNotClassicError';
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

export class WorkshopTaskWorkshopNotFoundError extends Error {
  public constructor(public readonly workshopId: string) {
    super(`Workshop ${workshopId} not found in tenant`);
    this.name = 'WorkshopTaskWorkshopNotFoundError';
  }
}

export class WorkshopTaskProductionNotFoundError extends Error {
  public constructor(public readonly productionId: string) {
    super(`Production ${productionId} not found in tenant`);
    this.name = 'WorkshopTaskProductionNotFoundError';
  }
}

const TASK_RAW_COLUMNS = `id, budget_item_id, graph_node_id, production_id, workshop_id,
           assignee_membership_id, status, description, planned_amount, start_at, deadline_at, completed_at,
           rejected_at`;
const TASK_COLUMNS = `id, budget_item_id AS "budgetItemId", graph_node_id AS "graphNodeId",
           production_id AS "productionId", workshop_id AS "workshopId",
           assignee_membership_id AS "assigneeMembershipId",
           status, description, planned_amount AS "plannedAmount",
           to_char(start_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "startAt",
           to_char(deadline_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "deadlineAt",
           to_char(completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "completedAt",
           to_char(rejected_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "rejectedAt"`;

export class PostgresWorkshopTaskRepository {
  public constructor(private readonly client: SqlClient) {}

  public async createTaskFromBudgetItem(
    context: TenantContext,
    input: CreateTaskFromBudgetItemInput,
  ): Promise<StoredWorkshopTaskWithStages> {
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
    const stageIds = DEFAULT_TASK_STAGE_LABELS.map(() => randomUUID());
    const stageIndexes = DEFAULT_TASK_STAGE_LABELS.map((_, index) => index);
    const result = await this.client.query<StoredWorkshopTask>(
      `WITH created AS (
         INSERT INTO workshop_tasks (
           id, tenant_id, budget_item_id, production_id, workshop_id,
           assignee_membership_id, status, description, deadline_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, NOW())
         RETURNING ${TASK_RAW_COLUMNS}
       ), stages_inserted AS (
         INSERT INTO task_stages (id, tenant_id, task_id, label, status, sort_order, started_at, updated_at)
         SELECT stage_id, $2, $1, label, CASE WHEN idx = 0 THEN 'in_progress' ELSE 'pending' END,
                idx + 1, CASE WHEN idx = 0 THEN NOW() ELSE NULL END, NOW()
         FROM unnest($12::uuid[], $13::text[], $14::int[]) AS s(stage_id, label, idx)
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
        DEFAULT_CLASSIC_TASK_STATUS,
        description,
        input.deadlineAt ?? null,
        randomUUID(),
        context.membershipId,
        stageIds,
        DEFAULT_TASK_STAGE_LABELS,
        stageIndexes,
      ],
    );

    return this.attachStages(context, result.rows[0]!);
  }

  public async listTasksByWorkshop(context: TenantContext, workshopId: string): Promise<StoredWorkshopTaskWithStages[]> {
    const result = await this.client.query<StoredWorkshopTask>(
      `SELECT ${TASK_COLUMNS}
       FROM workshop_tasks
       WHERE tenant_id = $1 AND workshop_id = $2
       ORDER BY created_at ASC`,
      [context.tenantId, workshopId],
    );

    return this.attachStagesBatch(context, result.rows);
  }

  /** For the "Смета" Gantt board — every task across every workshop of one production. */
  public async listTasksByProduction(context: TenantContext, productionId: string): Promise<StoredWorkshopTaskWithStages[]> {
    const result = await this.client.query<StoredWorkshopTask>(
      `SELECT ${TASK_COLUMNS}
       FROM workshop_tasks
       WHERE tenant_id = $1 AND production_id = $2
       ORDER BY created_at ASC`,
      [context.tenantId, productionId],
    );

    return this.attachStagesBatch(context, result.rows);
  }

  private async listTaskStages(context: TenantContext, taskId: string): Promise<StoredTaskStage[]> {
    const result = await this.client.query<StoredTaskStage>(
      `SELECT id, task_id AS "taskId", label, status, sort_order AS "sortOrder",
              to_char(started_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "startedAt",
              to_char(completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "completedAt"
       FROM task_stages
       WHERE tenant_id = $1 AND task_id = $2
       ORDER BY sort_order ASC`,
      [context.tenantId, taskId],
    );
    return result.rows;
  }

  private async attachStages(context: TenantContext, task: StoredWorkshopTask): Promise<StoredWorkshopTaskWithStages> {
    return { ...task, stages: await this.listTaskStages(context, task.id) };
  }

  /** Batched equivalent of attachStages, for list endpoints — mirrors how
      listGraphNodeTasks batches its own assignees rather than querying
      per row. Graph-node tasks (never seeded any TaskStage rows) simply
      come back with `stages: []`. */
  private async attachStagesBatch(
    context: TenantContext,
    tasks: StoredWorkshopTask[],
  ): Promise<StoredWorkshopTaskWithStages[]> {
    if (tasks.length === 0) return [];

    const stages = await this.client.query<{ taskId: string } & StoredTaskStage>(
      `SELECT task_id AS "taskId", id, label, status, sort_order AS "sortOrder",
              to_char(started_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "startedAt",
              to_char(completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "completedAt"
       FROM task_stages
       WHERE tenant_id = $1 AND task_id = ANY($2::uuid[])
       ORDER BY sort_order ASC`,
      [context.tenantId, tasks.map((task) => task.id)],
    );
    const byTask = new Map<string, StoredTaskStage[]>();
    for (const row of stages.rows) {
      const list = byTask.get(row.taskId) ?? [];
      list.push({
        id: row.id,
        taskId: row.taskId,
        label: row.label,
        status: row.status,
        sortOrder: row.sortOrder,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
      });
      byTask.set(row.taskId, list);
    }

    return tasks.map((task) => ({ ...task, stages: byTask.get(task.id) ?? [] }));
  }

  /**
   * A bare task for the "Смета" calendar — not tied to a `budget_item`
   * (Инкремент 3's approved-item flow) or a graph node (Инкремент 8's
   * visual constructor). `productionId`/`workshopId` are taken directly
   * since the calendar already knows both from the page it's on.
   */
  public async createTaskForWorkshop(
    context: TenantContext,
    input: CreateTaskForWorkshopInput,
  ): Promise<StoredWorkshopTaskWithStages> {
    const production = await this.client.query(
      'SELECT 1 FROM productions WHERE id = $1 AND tenant_id = $2',
      [input.productionId, context.tenantId],
    );
    if ((production.rowCount ?? 0) === 0) throw new WorkshopTaskProductionNotFoundError(input.productionId);

    const workshop = await this.client.query(
      'SELECT 1 FROM workshops WHERE id = $1 AND tenant_id = $2',
      [input.workshopId, context.tenantId],
    );
    if ((workshop.rowCount ?? 0) === 0) throw new WorkshopTaskWorkshopNotFoundError(input.workshopId);

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
    const stageIds = DEFAULT_TASK_STAGE_LABELS.map(() => randomUUID());
    const stageIndexes = DEFAULT_TASK_STAGE_LABELS.map((_, index) => index);
    const result = await this.client.query<StoredWorkshopTask>(
      `WITH created AS (
         INSERT INTO workshop_tasks (
           id, tenant_id, budget_item_id, graph_node_id, production_id, workshop_id,
           assignee_membership_id, status, description, planned_amount, start_at, deadline_at, updated_at
         )
         VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, $7, NULL, $8::timestamptz, $9::timestamptz, NOW())
         RETURNING ${TASK_RAW_COLUMNS}
       ), stages_inserted AS (
         INSERT INTO task_stages (id, tenant_id, task_id, label, status, sort_order, started_at, updated_at)
         SELECT stage_id, $2, $1, label, CASE WHEN idx = 0 THEN 'in_progress' ELSE 'pending' END,
                idx + 1, CASE WHEN idx = 0 THEN NOW() ELSE NULL END, NOW()
         FROM unnest($12::uuid[], $13::text[], $14::int[]) AS s(stage_id, label, idx)
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $10, $2, $11, 'workshop_task.created', 'workshop_task', id,
           jsonb_build_object('workshopId', $4, 'description', $7)
         FROM created
       )
       SELECT ${TASK_COLUMNS} FROM created`,
      [
        taskId,
        context.tenantId,
        input.productionId,
        input.workshopId,
        input.assigneeMembershipId ?? null,
        DEFAULT_CLASSIC_TASK_STATUS,
        input.description,
        input.startAt ?? input.deadlineAt,
        input.deadlineAt,
        randomUUID(),
        context.membershipId,
        stageIds,
        DEFAULT_TASK_STAGE_LABELS,
        stageIndexes,
      ],
    );

    return this.attachStages(context, result.rows[0]!);
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

    const sortOrder = await this.resolveGraphNodeTaskSortOrder(context, graphNodeId, input.afterTaskId);

    const taskId = randomUUID();
    const assigneeRowIds = input.assigneeMembershipIds.map(() => randomUUID());
    const result = await this.client.query<StoredWorkshopTask>(
      `WITH created AS (
         INSERT INTO workshop_tasks (
           id, tenant_id, budget_item_id, graph_node_id, production_id, workshop_id,
           assignee_membership_id, status, description, planned_amount, deadline_at, sort_order, updated_at
         )
         VALUES ($1, $2, NULL, $3, $4, $5, NULL, $6, $7, $8::numeric, $9::timestamptz, $14::numeric, NOW())
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
        sortOrder,
      ],
    );

    return { ...result.rows[0]!, assignees: await this.listAssignees(context, taskId) };
  }

  /**
   * Fractional-index position for a new graph-node task ("этап"). No
   * `afterTaskId` appends at the end (max + 1); given one, the new task
   * sits at the midpoint between it and whichever task currently comes
   * right after it (or +1 past it, if it's currently last) — an ordinary
   * insert-between that never has to renumber existing rows.
   */
  private async resolveGraphNodeTaskSortOrder(
    context: TenantContext,
    graphNodeId: string,
    afterTaskId: string | undefined,
  ): Promise<string> {
    if (!afterTaskId) {
      const appended = await this.client.query<{ next: string }>(
        `SELECT (COALESCE(MAX(sort_order), 0) + 1)::text AS next
         FROM workshop_tasks WHERE tenant_id = $1 AND graph_node_id = $2`,
        [context.tenantId, graphNodeId],
      );
      return appended.rows[0]!.next;
    }

    const after = await this.client.query<{ sortOrder: string }>(
      `SELECT sort_order AS "sortOrder" FROM workshop_tasks
       WHERE tenant_id = $1 AND graph_node_id = $2 AND id = $3`,
      [context.tenantId, graphNodeId, afterTaskId],
    );
    const afterRow = after.rows[0];
    if (!afterRow) throw new WorkshopTaskAfterTaskNotFoundError(afterTaskId);

    const next = await this.client.query<{ sortOrder: string }>(
      `SELECT sort_order AS "sortOrder" FROM workshop_tasks
       WHERE tenant_id = $1 AND graph_node_id = $2 AND sort_order > $3::numeric
       ORDER BY sort_order ASC LIMIT 1`,
      [context.tenantId, graphNodeId, afterRow.sortOrder],
    );
    const nextRow = next.rows[0];

    const computed = await this.client.query<{ value: string }>(
      nextRow
        ? `SELECT (($1::numeric + $2::numeric) / 2)::text AS value`
        : `SELECT ($1::numeric + 1)::text AS value`,
      nextRow ? [afterRow.sortOrder, nextRow.sortOrder] : [afterRow.sortOrder],
    );
    return computed.rows[0]!.value;
  }

  /**
   * Fractional-index position for a new task stage ("этап") — same
   * midpoint-insertion scheme as resolveGraphNodeTaskSortOrder above,
   * scoped to one classic task's stages instead of one graph node's tasks.
   */
  private async resolveTaskStageSortOrder(
    context: TenantContext,
    taskId: string,
    afterStageId: string | undefined,
  ): Promise<string> {
    if (!afterStageId) {
      const appended = await this.client.query<{ next: string }>(
        `SELECT (COALESCE(MAX(sort_order), 0) + 1)::text AS next
         FROM task_stages WHERE tenant_id = $1 AND task_id = $2`,
        [context.tenantId, taskId],
      );
      return appended.rows[0]!.next;
    }

    const after = await this.client.query<{ sortOrder: string }>(
      `SELECT sort_order AS "sortOrder" FROM task_stages
       WHERE tenant_id = $1 AND task_id = $2 AND id = $3`,
      [context.tenantId, taskId, afterStageId],
    );
    const afterRow = after.rows[0];
    if (!afterRow) throw new WorkshopTaskStageNotFoundError(afterStageId);

    const next = await this.client.query<{ sortOrder: string }>(
      `SELECT sort_order AS "sortOrder" FROM task_stages
       WHERE tenant_id = $1 AND task_id = $2 AND sort_order > $3::numeric
       ORDER BY sort_order ASC LIMIT 1`,
      [context.tenantId, taskId, afterRow.sortOrder],
    );
    const nextRow = next.rows[0];

    const computed = await this.client.query<{ value: string }>(
      nextRow
        ? `SELECT (($1::numeric + $2::numeric) / 2)::text AS value`
        : `SELECT ($1::numeric + 1)::text AS value`,
      nextRow ? [afterRow.sortOrder, nextRow.sortOrder] : [afterRow.sortOrder],
    );
    return computed.rows[0]!.value;
  }

  /** Guard shared by every stage endpoint (add/edit/advance/revert/reject)
      — none of them make sense for a graph-node task. Returns null if the
      task doesn't exist in this tenant at all. */
  private async requireClassicTask(
    context: TenantContext,
    taskId: string,
  ): Promise<{ graphNodeId: string | null; rejectedAt: string | null; completedAt: string | null } | null> {
    const result = await this.client.query<{ graphNodeId: string | null; rejectedAt: string | null; completedAt: string | null }>(
      `SELECT graph_node_id AS "graphNodeId", rejected_at AS "rejectedAt", completed_at AS "completedAt"
       FROM workshop_tasks WHERE id = $1 AND tenant_id = $2`,
      [taskId, context.tenantId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.graphNodeId !== null) throw new WorkshopTaskNotClassicError(taskId);
    return row;
  }

  public async listGraphNodeTasks(
    context: TenantContext,
    graphNodeId: string,
  ): Promise<StoredWorkshopTaskWithAssignees[]> {
    const result = await this.client.query<StoredWorkshopTask>(
      `SELECT ${TASK_COLUMNS}
       FROM workshop_tasks
       WHERE tenant_id = $1 AND graph_node_id = $2
       ORDER BY sort_order ASC`,
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
  ): Promise<StoredWorkshopTaskWithStages | null> {
    // Deliberately NOT requireClassicTask here — assign has always worked
    // on graph-node tasks too (a pre-existing, accepted latent gap; see
    // plan §"Gaps you should decide on" item 3) and reassigning is no
    // longer gated on a specific status, only on not being rejected.
    const existing = await this.client.query<{ rejectedAt: string | null }>(
      'SELECT rejected_at AS "rejectedAt" FROM workshop_tasks WHERE id = $1 AND tenant_id = $2',
      [taskId, context.tenantId],
    );
    const current = existing.rows[0];
    if (!current) return null;
    if (current.rejectedAt !== null) throw new WorkshopTaskRejectedError(taskId);

    const assignee = await this.client.query(
      'SELECT 1 FROM memberships WHERE id = $1 AND tenant_id = $2',
      [assigneeMembershipId, context.tenantId],
    );
    if ((assignee.rowCount ?? 0) === 0) throw new WorkshopTaskAssigneeNotFoundError(assigneeMembershipId);

    const result = await this.client.query<StoredWorkshopTask>(
      `WITH updated AS (
         UPDATE workshop_tasks
         SET assignee_membership_id = $3, updated_at = NOW()
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

    return this.attachStages(context, result.rows[0]!);
  }

  /** "Принять" — the one in-progress stage is marked done and the next
      stage (by sort order) becomes in-progress; reaching the end of the
      list instead marks the whole task completed. */
  public async advanceTask(context: TenantContext, taskId: string): Promise<StoredWorkshopTaskWithStages | null> {
    const info = await this.requireClassicTask(context, taskId);
    if (info === null) return null;
    if (info.rejectedAt !== null) throw new WorkshopTaskRejectedError(taskId);
    if (info.completedAt !== null) throw new WorkshopTaskAlreadyCompletedError(taskId);

    const active = await this.client.query<{ id: string; sortOrder: string }>(
      `SELECT id, sort_order AS "sortOrder" FROM task_stages
       WHERE tenant_id = $1 AND task_id = $2 AND status = 'in_progress'`,
      [context.tenantId, taskId],
    );
    const activeStage = active.rows[0];
    if (!activeStage) throw new WorkshopTaskNoActiveStageError(taskId);

    const next = await this.client.query<{ id: string }>(
      `SELECT id FROM task_stages
       WHERE tenant_id = $1 AND task_id = $2 AND sort_order > $3::numeric
       ORDER BY sort_order ASC LIMIT 1`,
      [context.tenantId, taskId, activeStage.sortOrder],
    );
    const nextStage = next.rows[0];

    await this.client.query(
      `UPDATE task_stages SET status = 'done', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [activeStage.id, context.tenantId],
    );
    if (nextStage) {
      await this.client.query(
        `UPDATE task_stages SET status = 'in_progress', started_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
        [nextStage.id, context.tenantId],
      );
    }

    const taskCompletedAtSql = nextStage ? 'completed_at' : 'NOW()';
    const result = await this.client.query<StoredWorkshopTask>(
      `WITH updated AS (
         UPDATE workshop_tasks
         SET completed_at = ${taskCompletedAtSql}, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING ${TASK_RAW_COLUMNS}
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $3, $2, $4, 'workshop_task.advanced', 'workshop_task', id,
           jsonb_build_object('fromStageId', $5::uuid, 'toStageId', $6::uuid)
         FROM updated
       )
       SELECT ${TASK_COLUMNS} FROM updated`,
      [taskId, context.tenantId, randomUUID(), context.membershipId, activeStage.id, nextStage ? nextStage.id : null],
    );

    return this.attachStages(context, result.rows[0]!);
  }

  /** "Вернуть в работу" — either un-finishes a fully-completed task (the
      last stage goes back to in-progress) or, mid-flow, moves the
      in-progress stage back to the nearest earlier done stage. */
  public async revertTask(context: TenantContext, taskId: string): Promise<StoredWorkshopTaskWithStages | null> {
    const info = await this.requireClassicTask(context, taskId);
    if (info === null) return null;
    if (info.rejectedAt !== null) throw new WorkshopTaskRejectedError(taskId);

    if (info.completedAt !== null) {
      const last = await this.client.query<{ id: string }>(
        `SELECT id FROM task_stages WHERE tenant_id = $1 AND task_id = $2
         ORDER BY sort_order DESC LIMIT 1`,
        [context.tenantId, taskId],
      );
      const lastStage = last.rows[0];
      if (!lastStage) throw new WorkshopTaskNoActiveStageError(taskId);

      await this.client.query(
        `UPDATE task_stages SET status = 'in_progress', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        [lastStage.id, context.tenantId],
      );

      const result = await this.client.query<StoredWorkshopTask>(
        `WITH updated AS (
           UPDATE workshop_tasks SET completed_at = NULL, updated_at = NOW()
           WHERE id = $1 AND tenant_id = $2
           RETURNING ${TASK_RAW_COLUMNS}
         ), audited AS (
           INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
           SELECT $3, $2, $4, 'workshop_task.reverted', 'workshop_task', id,
             jsonb_build_object('toStageId', $5::uuid)
           FROM updated
         )
         SELECT ${TASK_COLUMNS} FROM updated`,
        [taskId, context.tenantId, randomUUID(), context.membershipId, lastStage.id],
      );

      return this.attachStages(context, result.rows[0]!);
    }

    const active = await this.client.query<{ id: string; sortOrder: string }>(
      `SELECT id, sort_order AS "sortOrder" FROM task_stages
       WHERE tenant_id = $1 AND task_id = $2 AND status = 'in_progress'`,
      [context.tenantId, taskId],
    );
    const activeStage = active.rows[0];
    if (!activeStage) throw new WorkshopTaskNoActiveStageError(taskId);

    const preceding = await this.client.query<{ id: string }>(
      `SELECT id FROM task_stages
       WHERE tenant_id = $1 AND task_id = $2 AND sort_order < $3::numeric AND status = 'done'
       ORDER BY sort_order DESC LIMIT 1`,
      [context.tenantId, taskId, activeStage.sortOrder],
    );
    const precedingStage = preceding.rows[0];
    if (!precedingStage) throw new WorkshopTaskNoPrecedingStageError(taskId);

    await this.client.query(
      `UPDATE task_stages SET status = 'pending', started_at = NULL, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [activeStage.id, context.tenantId],
    );
    await this.client.query(
      `UPDATE task_stages SET status = 'in_progress', completed_at = NULL, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [precedingStage.id, context.tenantId],
    );

    const result = await this.client.query<StoredWorkshopTask>(
      `WITH updated AS (
         UPDATE workshop_tasks SET updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING ${TASK_RAW_COLUMNS}
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $3, $2, $4, 'workshop_task.reverted', 'workshop_task', id,
           jsonb_build_object('fromStageId', $5::uuid, 'toStageId', $6::uuid)
         FROM updated
       )
       SELECT ${TASK_COLUMNS} FROM updated`,
      [taskId, context.tenantId, randomUUID(), context.membershipId, activeStage.id, precedingStage.id],
    );

    return this.attachStages(context, result.rows[0]!);
  }

  /** "Отклонить" — terminal, freezes stage progress as-is. No un-reject in v1. */
  public async rejectTask(context: TenantContext, taskId: string): Promise<StoredWorkshopTaskWithStages | null> {
    const info = await this.requireClassicTask(context, taskId);
    if (info === null) return null;
    if (info.rejectedAt !== null) throw new WorkshopTaskAlreadyRejectedError(taskId);

    const result = await this.client.query<StoredWorkshopTask>(
      `WITH updated AS (
         UPDATE workshop_tasks
         SET status = 'rejected', rejected_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING ${TASK_RAW_COLUMNS}
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $3, $2, $4, 'workshop_task.rejected', 'workshop_task', id, '{}'::jsonb
         FROM updated
       )
       SELECT ${TASK_COLUMNS} FROM updated`,
      [taskId, context.tenantId, randomUUID(), context.membershipId],
    );

    return this.attachStages(context, result.rows[0]!);
  }

  /** "Добавить этап" — inserts a new custom stage, appended at the end by
      default or at the midpoint after `afterStageId`. Starts 'pending'. */
  public async addTaskStage(
    context: TenantContext,
    taskId: string,
    input: { label: string; afterStageId?: string },
  ): Promise<StoredWorkshopTaskWithStages | null> {
    const info = await this.requireClassicTask(context, taskId);
    if (info === null) return null;
    if (info.rejectedAt !== null) throw new WorkshopTaskRejectedError(taskId);

    const sortOrder = await this.resolveTaskStageSortOrder(context, taskId, input.afterStageId);
    const stageId = randomUUID();

    await this.client.query(
      `WITH inserted AS (
         INSERT INTO task_stages (id, tenant_id, task_id, label, status, sort_order, updated_at)
         VALUES ($1, $2, $3, $4, 'pending', $5::numeric, NOW())
         RETURNING id
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $6, $2, $7, 'workshop_task.stage_added', 'workshop_task', $3,
           jsonb_build_object('stageId', $1, 'label', $4)
         FROM inserted
       )
       SELECT 1 FROM inserted`,
      [stageId, context.tenantId, taskId, input.label, sortOrder, randomUUID(), context.membershipId],
    );

    const task = (await this.loadTask(context, taskId))!;
    return this.attachStages(context, task);
  }

  /** "Редактировать этап" — rename only; no reordering in v1. */
  public async editTaskStage(
    context: TenantContext,
    taskId: string,
    stageId: string,
    input: { label: string },
  ): Promise<StoredWorkshopTaskWithStages | null> {
    const info = await this.requireClassicTask(context, taskId);
    if (info === null) return null;
    if (info.rejectedAt !== null) throw new WorkshopTaskRejectedError(taskId);

    const existing = await this.client.query<{ label: string }>(
      'SELECT label FROM task_stages WHERE id = $1 AND tenant_id = $2 AND task_id = $3',
      [stageId, context.tenantId, taskId],
    );
    const previousStage = existing.rows[0];
    if (!previousStage) throw new WorkshopTaskStageNotFoundError(stageId);

    await this.client.query(
      `WITH updated AS (
         UPDATE task_stages SET label = $1, updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3 AND task_id = $4
         RETURNING id
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $5, $3, $6, 'workshop_task.stage_renamed', 'workshop_task', $4,
           jsonb_build_object('stageId', $2, 'from', $7::text, 'to', $1)
         FROM updated
       )
       SELECT 1 FROM updated`,
      [input.label, stageId, context.tenantId, taskId, randomUUID(), context.membershipId, previousStage.label],
    );

    const task = (await this.loadTask(context, taskId))!;
    return this.attachStages(context, task);
  }

  private async loadTask(context: TenantContext, taskId: string): Promise<StoredWorkshopTask | null> {
    const result = await this.client.query<StoredWorkshopTask>(
      `SELECT ${TASK_COLUMNS} FROM workshop_tasks WHERE id = $1 AND tenant_id = $2`,
      [taskId, context.tenantId],
    );
    return result.rows[0] ?? null;
  }

  public async rescheduleTaskDeadline(
    context: TenantContext,
    taskId: string,
    newDeadlineAt: string | null,
    reason: string,
  ): Promise<StoredWorkshopTaskWithStages | null> {
    // Not requireClassicTask — reschedule is orthogonal to stage progress
    // and has always worked for graph-node tasks too; only the rejected
    // guard is new here (replacing the now-permanently-unreachable
    // `status === 'closed'` check).
    const existing = await this.client.query<{ rejectedAt: string | null }>(
      'SELECT rejected_at AS "rejectedAt" FROM workshop_tasks WHERE id = $1 AND tenant_id = $2',
      [taskId, context.tenantId],
    );
    const current = existing.rows[0];
    if (!current) return null;
    if (current.rejectedAt !== null) throw new WorkshopTaskRejectedError(taskId);

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

    return this.attachStages(context, result.rows[0]!);
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
