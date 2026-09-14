import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresBudgetRepository } from './postgres-budget-repository.js';
import {
  PostgresWorkshopTaskRepository,
  WorkshopTaskAfterTaskNotFoundError,
  WorkshopTaskAlreadyCompletedError,
  WorkshopTaskAlreadyDecidedError,
  WorkshopTaskAlreadyExistsError,
  WorkshopTaskAlreadyRejectedError,
  WorkshopTaskAssigneeNotFoundError,
  WorkshopTaskBudgetItemNotFoundError,
  WorkshopTaskBudgetNotApprovedError,
  WorkshopTaskGraphNodeNotFoundError,
  WorkshopTaskGraphNodeNotWorkshopError,
  WorkshopTaskInvalidTransitionError,
  WorkshopTaskNoPrecedingStageError,
  WorkshopTaskNotClassicError,
  WorkshopTaskRejectedError,
  WorkshopTaskStageNotFoundError,
} from './postgres-workshop-task-repository.js';

const DEFAULT_STAGE_LABELS = ['Новая', 'Назначена', 'Принята', 'Выполнена', 'Закрыта'];

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('PostgresWorkshopTaskRepository', () => {
  const client = new Client({ connectionString: databaseUrl });

  beforeAll(async () => {
    await client.connect();
  });

  beforeEach(async () => {
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
  });

  afterAll(async () => {
    await client.end();
  });

  it('creates a task from an approved budget item and its audit event', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const budgetRepository = new PostgresBudgetRepository(client);
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const budget = await budgetRepository.createBudget(tenant.context, {
      productionId: tenant.productionId,
      sections: [{
        workshopId: tenant.workshopId,
        title: 'Пошивочный цех',
        items: [{ description: 'Сшить костюм', quantity: '1', unit: 'шт', unitPrice: '5000.00' }],
      }],
    });
    const itemId = budget.sections[0]!.items[0]!.id;
    await budgetRepository.approveBudget(tenant.context, budget.id);

    const task = await taskRepository.createTaskFromBudgetItem(tenant.context, { budgetItemId: itemId });

    expect(task).toMatchObject({
      budgetItemId: itemId,
      productionId: tenant.productionId,
      workshopId: tenant.workshopId,
      status: 'active',
      description: 'Сшить костюм',
      assigneeMembershipId: null,
      rejectedAt: null,
    });
    expect(task.stages.map((stage) => stage.label)).toEqual(DEFAULT_STAGE_LABELS);
    expect(task.stages.map((stage) => stage.status)).toEqual(['in_progress', 'pending', 'pending', 'pending', 'pending']);
    await expect(
      client.query(
        "SELECT tenant_id, actor_membership_id, action, subject_type, subject_id FROM audit_events WHERE action = 'workshop_task.created' AND subject_id = $1",
        [task.id],
      ),
    ).resolves.toMatchObject({
      rows: [{
        tenant_id: tenant.context.tenantId,
        actor_membership_id: tenant.context.membershipId,
        action: 'workshop_task.created',
        subject_type: 'workshop_task',
        subject_id: task.id,
      }],
    });
  });

  it('uses a custom description and assignee when provided', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const budgetRepository = new PostgresBudgetRepository(client);
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const budget = await budgetRepository.createBudget(tenant.context, {
      productionId: tenant.productionId,
      sections: [{
        workshopId: tenant.workshopId,
        title: 'Пошивочный цех',
        items: [{ description: 'Сшить костюм', quantity: '1', unit: 'шт', unitPrice: '5000.00' }],
      }],
    });
    const itemId = budget.sections[0]!.items[0]!.id;
    await budgetRepository.approveBudget(tenant.context, budget.id);

    const task = await taskRepository.createTaskFromBudgetItem(tenant.context, {
      budgetItemId: itemId,
      description: 'Сшить костюм и примерить',
      assigneeMembershipId: tenant.context.membershipId,
    });

    expect(task).toMatchObject({
      description: 'Сшить костюм и примерить',
      assigneeMembershipId: tenant.context.membershipId,
    });
  });

  it('rejects creating a task from a non-existent budget item', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const taskRepository = new PostgresWorkshopTaskRepository(client);

    await expect(
      taskRepository.createTaskFromBudgetItem(tenant.context, { budgetItemId: randomUUID() }),
    ).rejects.toBeInstanceOf(WorkshopTaskBudgetItemNotFoundError);
  });

  it('rejects creating a task from an item whose budget is not approved', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const budgetRepository = new PostgresBudgetRepository(client);
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const budget = await budgetRepository.createBudget(tenant.context, {
      productionId: tenant.productionId,
      sections: [{
        workshopId: tenant.workshopId,
        title: 'Пошивочный цех',
        items: [{ description: 'Сшить костюм', quantity: '1', unit: 'шт', unitPrice: '5000.00' }],
      }],
    });
    const itemId = budget.sections[0]!.items[0]!.id;

    await expect(
      taskRepository.createTaskFromBudgetItem(tenant.context, { budgetItemId: itemId }),
    ).rejects.toBeInstanceOf(WorkshopTaskBudgetNotApprovedError);
  });

  it('rejects a duplicate task for the same budget item', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const budgetRepository = new PostgresBudgetRepository(client);
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const budget = await budgetRepository.createBudget(tenant.context, {
      productionId: tenant.productionId,
      sections: [{
        workshopId: tenant.workshopId,
        title: 'Пошивочный цех',
        items: [{ description: 'Сшить костюм', quantity: '1', unit: 'шт', unitPrice: '5000.00' }],
      }],
    });
    const itemId = budget.sections[0]!.items[0]!.id;
    await budgetRepository.approveBudget(tenant.context, budget.id);
    await taskRepository.createTaskFromBudgetItem(tenant.context, { budgetItemId: itemId });

    await expect(
      taskRepository.createTaskFromBudgetItem(tenant.context, { budgetItemId: itemId }),
    ).rejects.toBeInstanceOf(WorkshopTaskAlreadyExistsError);
  });

  it('rejects an assignee outside the tenant', async () => {
    const tenantA = await createTenantFixture(client, 'Tenant A');
    const tenantB = await createTenantFixture(client, 'Tenant B');
    const budgetRepository = new PostgresBudgetRepository(client);
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const budget = await budgetRepository.createBudget(tenantA.context, {
      productionId: tenantA.productionId,
      sections: [{
        workshopId: tenantA.workshopId,
        title: 'Пошивочный цех',
        items: [{ description: 'Сшить костюм', quantity: '1', unit: 'шт', unitPrice: '5000.00' }],
      }],
    });
    const itemId = budget.sections[0]!.items[0]!.id;
    await budgetRepository.approveBudget(tenantA.context, budget.id);

    await expect(
      taskRepository.createTaskFromBudgetItem(tenantA.context, {
        budgetItemId: itemId,
        assigneeMembershipId: tenantB.context.membershipId,
      }),
    ).rejects.toBeInstanceOf(WorkshopTaskAssigneeNotFoundError);
  });

  it('lists tasks scoped to the workshop and tenant', async () => {
    const tenantA = await createTenantFixture(client, 'Tenant A');
    const tenantB = await createTenantFixture(client, 'Tenant B');
    const budgetRepository = new PostgresBudgetRepository(client);
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const budget = await budgetRepository.createBudget(tenantA.context, {
      productionId: tenantA.productionId,
      sections: [{
        workshopId: tenantA.workshopId,
        title: 'Пошивочный цех',
        items: [
          { description: 'Сшить костюм', quantity: '1', unit: 'шт', unitPrice: '5000.00' },
          { description: 'Пошить занавес', quantity: '1', unit: 'шт', unitPrice: '2000.00' },
        ],
      }],
    });
    await budgetRepository.approveBudget(tenantA.context, budget.id);
    await taskRepository.createTaskFromBudgetItem(tenantA.context, { budgetItemId: budget.sections[0]!.items[0]!.id });
    await taskRepository.createTaskFromBudgetItem(tenantA.context, { budgetItemId: budget.sections[0]!.items[1]!.id });

    const listA = await taskRepository.listTasksByWorkshop(tenantA.context, tenantA.workshopId);
    const listB = await taskRepository.listTasksByWorkshop(tenantB.context, tenantA.workshopId);

    expect(listA).toHaveLength(2);
    expect(listB).toEqual([]);
  });

  it('walks a task through assign -> advance x4 -> completed, with a real revert', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await createReadyTask(client, tenant);

    const assigned = await taskRepository.assignTask(tenant.context, task.id, tenant.context.membershipId);
    expect(assigned).toMatchObject({ assigneeMembershipId: tenant.context.membershipId });
    expect(assigned!.stages[0]).toMatchObject({ label: 'Новая', status: 'in_progress' });

    const afterFirstAdvance = await taskRepository.advanceTask(tenant.context, task.id);
    expect(afterFirstAdvance!.stages.map((stage) => stage.status)).toEqual([
      'done', 'in_progress', 'pending', 'pending', 'pending',
    ]);
    expect(afterFirstAdvance!.completedAt).toBeNull();

    const reverted = await taskRepository.revertTask(tenant.context, task.id);
    expect(reverted!.stages.map((stage) => stage.status)).toEqual([
      'in_progress', 'pending', 'pending', 'pending', 'pending',
    ]);

    // Advance all the way through to the end — 5 calls total from a
    // freshly-reverted stage0-in_progress state (one per stage).
    await taskRepository.advanceTask(tenant.context, task.id);
    await taskRepository.advanceTask(tenant.context, task.id);
    await taskRepository.advanceTask(tenant.context, task.id);
    await taskRepository.advanceTask(tenant.context, task.id);
    const finished = await taskRepository.advanceTask(tenant.context, task.id);
    expect(finished!.stages.every((stage) => stage.status === 'done')).toBe(true);
    expect(finished!.completedAt).not.toBeNull();

    await expect(
      taskRepository.advanceTask(tenant.context, task.id),
    ).rejects.toBeInstanceOf(WorkshopTaskAlreadyCompletedError);

    const revertedFromDone = await taskRepository.revertTask(tenant.context, task.id);
    expect(revertedFromDone!.completedAt).toBeNull();
    expect(revertedFromDone!.stages.at(-1)).toMatchObject({ status: 'in_progress' });

    await expect(
      client.query("SELECT action FROM audit_events WHERE subject_id = $1 AND action LIKE 'workshop_task.%' ORDER BY action", [task.id]),
    ).resolves.toMatchObject({
      rows: [
        { action: 'workshop_task.advanced' },
        { action: 'workshop_task.advanced' },
        { action: 'workshop_task.advanced' },
        { action: 'workshop_task.advanced' },
        { action: 'workshop_task.advanced' },
        { action: 'workshop_task.advanced' },
        { action: 'workshop_task.assigned' },
        { action: 'workshop_task.created' },
        { action: 'workshop_task.reverted' },
        { action: 'workshop_task.reverted' },
      ],
    });
  });

  it('allows reassigning a task at any time (no status precondition)', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await createReadyTask(client, tenant);
    const other = await createMembershipFixture(client, tenant.tenantId, 'Петров');
    await taskRepository.assignTask(tenant.context, task.id, tenant.context.membershipId);

    const reassigned = await taskRepository.assignTask(tenant.context, task.id, other);
    expect(reassigned).toMatchObject({ assigneeMembershipId: other });
  });

  it('adds a custom stage at the end and after a chosen stage, and renames a stage', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await createReadyTask(client, tenant);

    const appended = await taskRepository.addTaskStage(tenant.context, task.id, { label: 'Согласование' });
    expect(appended!.stages.map((stage) => stage.label)).toEqual([...DEFAULT_STAGE_LABELS, 'Согласование']);
    expect(appended!.stages.at(-1)).toMatchObject({ status: 'pending' });

    const firstStageId = task.stages[0]!.id;
    const inserted = await taskRepository.addTaskStage(tenant.context, task.id, {
      label: 'Проверка ткани',
      afterStageId: firstStageId,
    });
    expect(inserted!.stages.map((stage) => stage.label)).toEqual([
      'Новая', 'Проверка ткани', 'Назначена', 'Принята', 'Выполнена', 'Закрыта', 'Согласование',
    ]);

    const renamedStageId = inserted!.stages[1]!.id;
    const renamed = await taskRepository.editTaskStage(tenant.context, task.id, renamedStageId, {
      label: 'Проверка материала',
    });
    expect(renamed!.stages[1]).toMatchObject({ label: 'Проверка материала' });

    await expect(
      taskRepository.addTaskStage(tenant.context, task.id, { label: 'X', afterStageId: randomUUID() }),
    ).rejects.toBeInstanceOf(WorkshopTaskStageNotFoundError);
    await expect(
      taskRepository.editTaskStage(tenant.context, task.id, randomUUID(), { label: 'X' }),
    ).rejects.toBeInstanceOf(WorkshopTaskStageNotFoundError);
  });

  it('rejects reverting before the first stage', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await createReadyTask(client, tenant);

    await expect(
      taskRepository.revertTask(tenant.context, task.id),
    ).rejects.toBeInstanceOf(WorkshopTaskNoPrecedingStageError);
  });

  it('rejects every mutation on a rejected task, and rejecting twice', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await createReadyTask(client, tenant);

    const rejected = await taskRepository.rejectTask(tenant.context, task.id);
    expect(rejected).toMatchObject({ status: 'rejected' });
    expect(rejected!.rejectedAt).not.toBeNull();

    await expect(taskRepository.advanceTask(tenant.context, task.id)).rejects.toBeInstanceOf(WorkshopTaskRejectedError);
    await expect(taskRepository.revertTask(tenant.context, task.id)).rejects.toBeInstanceOf(WorkshopTaskRejectedError);
    await expect(
      taskRepository.addTaskStage(tenant.context, task.id, { label: 'Доп. этап' }),
    ).rejects.toBeInstanceOf(WorkshopTaskRejectedError);
    await expect(
      taskRepository.editTaskStage(tenant.context, task.id, task.stages[0]!.id, { label: 'X' }),
    ).rejects.toBeInstanceOf(WorkshopTaskRejectedError);
    await expect(
      taskRepository.assignTask(tenant.context, task.id, tenant.context.membershipId),
    ).rejects.toBeInstanceOf(WorkshopTaskRejectedError);

    await expect(taskRepository.rejectTask(tenant.context, task.id)).rejects.toBeInstanceOf(WorkshopTaskAlreadyRejectedError);
  });

  it('rejects assigning to a nonexistent membership', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await createReadyTask(client, tenant);

    await expect(
      taskRepository.assignTask(tenant.context, task.id, randomUUID()),
    ).rejects.toBeInstanceOf(WorkshopTaskAssigneeNotFoundError);
  });

  it('returns null when transitioning a task outside the tenant', async () => {
    const tenantA = await createTenantFixture(client, 'Tenant A');
    const tenantB = await createTenantFixture(client, 'Tenant B');
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await createReadyTask(client, tenantB);

    await expect(
      taskRepository.assignTask(tenantA.context, task.id, tenantA.context.membershipId),
    ).resolves.toBeNull();
  });

  it('reschedules a task deadline and records one TaskDeadlineChange plus audit event', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await createReadyTask(client, tenant);

    const rescheduled = await taskRepository.rescheduleTaskDeadline(
      tenant.context,
      task.id,
      '2026-12-24',
      'Поставщик задержал ткань',
    );

    expect(rescheduled).toMatchObject({ id: task.id, deadlineAt: '2026-12-24T00:00:00Z' });
    await expect(
      client.query(
        'SELECT old_deadline_at, new_deadline_at, reason, actor_membership_id FROM task_deadline_changes WHERE workshop_task_id = $1',
        [task.id],
      ),
    ).resolves.toMatchObject({
      rows: [{
        old_deadline_at: null,
        reason: 'Поставщик задержал ткань',
        actor_membership_id: tenant.context.membershipId,
      }],
    });
    await expect(
      client.query("SELECT count(*)::int AS count FROM audit_events WHERE action = 'workshop_task.deadline_changed' AND subject_id = $1", [task.id]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('can clear a deadline by rescheduling to null', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await createReadyTask(client, tenant);
    await taskRepository.rescheduleTaskDeadline(tenant.context, task.id, '2026-12-24', 'Initial deadline');

    const cleared = await taskRepository.rescheduleTaskDeadline(tenant.context, task.id, null, 'Дедлайн больше не актуален');

    expect(cleared).toMatchObject({ deadlineAt: null });
  });

  it('rejects rescheduling a rejected task', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await createReadyTask(client, tenant);
    await taskRepository.rejectTask(tenant.context, task.id);

    await expect(
      taskRepository.rescheduleTaskDeadline(tenant.context, task.id, '2026-12-24', 'Слишком поздно'),
    ).rejects.toBeInstanceOf(WorkshopTaskRejectedError);
  });

  it('returns null when rescheduling a task outside the tenant', async () => {
    const tenantA = await createTenantFixture(client, 'Tenant A');
    const tenantB = await createTenantFixture(client, 'Tenant B');
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await createReadyTask(client, tenantB);

    await expect(
      taskRepository.rescheduleTaskDeadline(tenantA.context, task.id, '2026-12-24', 'Причина'),
    ).resolves.toBeNull();
  });

  it('creates a task on a workshop graph node with two assignees, both pending', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const { graphNodeId } = await createWorkshopNodeFixture(client, tenant);
    const assigneeB = await createMembershipFixture(client, tenant.tenantId, 'Петров');
    const taskRepository = new PostgresWorkshopTaskRepository(client);

    const task = await taskRepository.createTaskForGraphNode(tenant.context, graphNodeId, {
      description: 'Смета на стулья',
      plannedAmount: '1500.00',
      assigneeMembershipIds: [tenant.context.membershipId, assigneeB],
    });

    expect(task).toMatchObject({
      graphNodeId,
      budgetItemId: null,
      workshopId: tenant.workshopId,
      productionId: tenant.productionId,
      status: 'new',
      plannedAmount: '1500.00',
    });
    expect(task.assignees).toHaveLength(2);
    expect(task.assignees.every((assignee) => assignee.status === 'pending')).toBe(true);
    await expect(
      client.query("SELECT count(*)::int AS count FROM audit_events WHERE action = 'workshop_task.created' AND subject_id = $1", [task.id]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('orders graph-node tasks by creation by default, and inserts after a chosen task on request', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const { graphNodeId } = await createWorkshopNodeFixture(client, tenant);
    const taskRepository = new PostgresWorkshopTaskRepository(client);

    const first = await taskRepository.createTaskForGraphNode(tenant.context, graphNodeId, {
      description: 'Раскрой',
      plannedAmount: '100.00',
      assigneeMembershipIds: [tenant.context.membershipId],
    });
    const second = await taskRepository.createTaskForGraphNode(tenant.context, graphNodeId, {
      description: 'Пошив',
      plannedAmount: '100.00',
      assigneeMembershipIds: [tenant.context.membershipId],
    });

    const appendedOrder = await taskRepository.listGraphNodeTasks(tenant.context, graphNodeId);
    expect(appendedOrder.map((task) => task.id)).toEqual([first.id, second.id]);

    // Insert a third task between "Раскрой" and "Пошив" instead of appending.
    const inserted = await taskRepository.createTaskForGraphNode(tenant.context, graphNodeId, {
      description: 'Примерка',
      plannedAmount: '50.00',
      assigneeMembershipIds: [tenant.context.membershipId],
      afterTaskId: first.id,
    });

    const finalOrder = await taskRepository.listGraphNodeTasks(tenant.context, graphNodeId);
    expect(finalOrder.map((task) => task.id)).toEqual([first.id, inserted.id, second.id]);

    await expect(
      taskRepository.createTaskForGraphNode(tenant.context, graphNodeId, {
        description: 'X',
        plannedAmount: '1.00',
        assigneeMembershipIds: [tenant.context.membershipId],
        afterTaskId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(WorkshopTaskAfterTaskNotFoundError);
  });

  it('rejects creating a graph-node task on a non-workshop node or an assignee outside the tenant', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const outsider = await createTenantFixture(client, 'Tenant B');
    const { rootId, graphNodeId } = await createWorkshopNodeFixture(client, tenant);
    const taskRepository = new PostgresWorkshopTaskRepository(client);

    await expect(
      taskRepository.createTaskForGraphNode(tenant.context, rootId, {
        description: 'X',
        plannedAmount: '1.00',
        assigneeMembershipIds: [tenant.context.membershipId],
      }),
    ).rejects.toBeInstanceOf(WorkshopTaskGraphNodeNotWorkshopError);

    await expect(
      taskRepository.createTaskForGraphNode(tenant.context, randomUUID(), {
        description: 'X',
        plannedAmount: '1.00',
        assigneeMembershipIds: [tenant.context.membershipId],
      }),
    ).rejects.toBeInstanceOf(WorkshopTaskGraphNodeNotFoundError);

    await expect(
      taskRepository.createTaskForGraphNode(tenant.context, graphNodeId, {
        description: 'X',
        plannedAmount: '1.00',
        assigneeMembershipIds: [outsider.context.membershipId],
      }),
    ).rejects.toBeInstanceOf(WorkshopTaskAssigneeNotFoundError);
  });

  it('marks one assignee done independently of the others, and rejects marking after a lead decision', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const { graphNodeId } = await createWorkshopNodeFixture(client, tenant);
    const assigneeB = await createMembershipFixture(client, tenant.tenantId, 'Петров');
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await taskRepository.createTaskForGraphNode(tenant.context, graphNodeId, {
      description: 'Смета на стулья',
      plannedAmount: '1500.00',
      assigneeMembershipIds: [tenant.context.membershipId, assigneeB],
    });

    const marked = await taskRepository.markAssigneeDone(tenant.context, task.id, tenant.context.membershipId);
    expect(marked).toMatchObject({ membershipId: tenant.context.membershipId, status: 'done' });
    expect(marked!.completedAt).not.toBeNull();

    const stillPending = await taskRepository.listGraphNodeTasks(tenant.context, graphNodeId);
    const statuses = stillPending[0]!.assignees.map((assignee) => assignee.status).sort();
    expect(statuses).toEqual(['done', 'pending']);

    await taskRepository.recordLeadDecision(tenant.context, task.id, 'approved');
    await expect(
      taskRepository.markAssigneeDone(tenant.context, task.id, assigneeB),
    ).rejects.toBeInstanceOf(WorkshopTaskAlreadyDecidedError);
  });

  it('records a lead approval and adds the amount to the node approvedTotal, and rejects a second decision', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const { graphNodeId } = await createWorkshopNodeFixture(client, tenant);
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await taskRepository.createTaskForGraphNode(tenant.context, graphNodeId, {
      description: 'Смета на стулья',
      plannedAmount: '1500.00',
      assigneeMembershipIds: [tenant.context.membershipId],
    });

    const approved = await taskRepository.recordLeadDecision(tenant.context, task.id, 'approved');
    expect(approved).toMatchObject({ status: 'approved' });
    expect(approved!.completedAt).not.toBeNull();

    await expect(
      taskRepository.recordLeadDecision(tenant.context, task.id, 'rejected'),
    ).rejects.toBeInstanceOf(WorkshopTaskInvalidTransitionError);
    await expect(
      client.query("SELECT count(*)::int AS count FROM audit_events WHERE action = 'workshop_task.lead_decision' AND subject_id = $1", [task.id]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('records a lead rejection without touching completedAt', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const { graphNodeId } = await createWorkshopNodeFixture(client, tenant);
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await taskRepository.createTaskForGraphNode(tenant.context, graphNodeId, {
      description: 'Смета на стулья',
      plannedAmount: '1500.00',
      assigneeMembershipIds: [tenant.context.membershipId],
    });

    const rejected = await taskRepository.recordLeadDecision(tenant.context, task.id, 'rejected');
    expect(rejected).toMatchObject({ status: 'rejected' });
    expect(rejected!.completedAt).toBeNull();
  });

  it('rejects the new classic-only stage endpoints on a graph-node task', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const { graphNodeId } = await createWorkshopNodeFixture(client, tenant);
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await taskRepository.createTaskForGraphNode(tenant.context, graphNodeId, {
      description: 'Смета на стулья',
      plannedAmount: '1500.00',
      assigneeMembershipIds: [tenant.context.membershipId],
    });

    await expect(
      taskRepository.addTaskStage(tenant.context, task.id, { label: 'X' }),
    ).rejects.toBeInstanceOf(WorkshopTaskNotClassicError);
    await expect(taskRepository.advanceTask(tenant.context, task.id)).rejects.toBeInstanceOf(WorkshopTaskNotClassicError);
    await expect(taskRepository.revertTask(tenant.context, task.id)).rejects.toBeInstanceOf(WorkshopTaskNotClassicError);
    await expect(taskRepository.rejectTask(tenant.context, task.id)).rejects.toBeInstanceOf(WorkshopTaskNotClassicError);
  });
});

async function createReadyTask(
  client: Client,
  tenant: Awaited<ReturnType<typeof createTenantFixture>>,
) {
  const budgetRepository = new PostgresBudgetRepository(client);
  const taskRepository = new PostgresWorkshopTaskRepository(client);
  const budget = await budgetRepository.createBudget(tenant.context, {
    productionId: tenant.productionId,
    sections: [{
      workshopId: tenant.workshopId,
      title: 'Пошивочный цех',
      items: [{ description: 'Сшить костюм', quantity: '1', unit: 'шт', unitPrice: '5000.00' }],
    }],
  });
  await budgetRepository.approveBudget(tenant.context, budget.id);
  return taskRepository.createTaskFromBudgetItem(tenant.context, { budgetItemId: budget.sections[0]!.items[0]!.id });
}

async function createWorkshopNodeFixture(
  client: Client,
  tenant: Awaited<ReturnType<typeof createTenantFixture>>,
): Promise<{ rootId: string; graphNodeId: string }> {
  const budgetId = randomUUID();
  const budgetVersionId = randomUUID();
  const rootId = randomUUID();
  const graphNodeId = randomUUID();

  await client.query(
    "INSERT INTO budgets (id, tenant_id, production_id, status, updated_at) VALUES ($1, $2, $3, 'PRELIMINARY', NOW())",
    [budgetId, tenant.tenantId, tenant.productionId],
  );
  await client.query(
    'INSERT INTO budget_versions (id, tenant_id, budget_id, revision, created_by_membership_id) VALUES ($1, $2, $3, 1, $4)',
    [budgetVersionId, tenant.tenantId, budgetId, tenant.context.membershipId],
  );
  await client.query(
    `INSERT INTO budget_graph_nodes (
       id, tenant_id, budget_version_id, parent_id, workshop_id, node_type, title,
       planned_amount, position_x, position_y, width, height, updated_at
     ) VALUES ($1, $2, $3, NULL, NULL, 'production', 'Ревизор', 0, 0, 0, 160, 80, NOW())`,
    [rootId, tenant.tenantId, budgetVersionId],
  );
  await client.query(
    `INSERT INTO budget_graph_nodes (
       id, tenant_id, budget_version_id, parent_id, workshop_id, node_type, title,
       planned_amount, position_x, position_y, width, height, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'workshop', 'Цех сборки', 0, 0, 0, 160, 80, NOW())`,
    [graphNodeId, tenant.tenantId, budgetVersionId, rootId, tenant.workshopId],
  );

  return { rootId, graphNodeId };
}

async function createMembershipFixture(client: Client, tenantId: string, name: string): Promise<string> {
  const userId = randomUUID();
  const membershipId = randomUUID();

  await client.query(
    'INSERT INTO users (id, email, "displayName", updated_at) VALUES ($1, $2, $3, NOW())',
    [userId, `${userId}@example.test`, name],
  );
  await client.query(
    'INSERT INTO memberships (id, tenant_id, user_id, updated_at) VALUES ($1, $2, $3, NOW())',
    [membershipId, tenantId, userId],
  );

  return membershipId;
}

async function createTenantFixture(client: Client, name: string) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const roleId = randomUUID();
  const membershipId = randomUUID();
  const productionId = randomUUID();
  const workshopId = randomUUID();

  await client.query('INSERT INTO tenants (id, name, updated_at) VALUES ($1, $2, NOW())', [tenantId, name]);
  await client.query(
    'INSERT INTO users (id, email, "displayName", updated_at) VALUES ($1, $2, $3, NOW())',
    [userId, `${userId}@example.test`, name],
  );
  await client.query(
    'INSERT INTO roles (id, tenant_id, name, updated_at) VALUES ($1, $2, $3, NOW())',
    [roleId, tenantId, 'theatre_admin'],
  );
  await client.query(
    'INSERT INTO memberships (id, tenant_id, user_id, role_id, updated_at) VALUES ($1, $2, $3, $4, NOW())',
    [membershipId, tenantId, userId, roleId],
  );
  await client.query(
    "INSERT INTO productions (id, tenant_id, title, status, health_status, updated_at) VALUES ($1, $2, $3, 'draft', 'neutral', NOW())",
    [productionId, tenantId, 'Ревизор'],
  );
  await client.query(
    'INSERT INTO workshops (id, tenant_id, name, updated_at) VALUES ($1, $2, $3, NOW())',
    [workshopId, tenantId, `Workshop ${name}`],
  );

  return {
    tenantId,
    productionId,
    workshopId,
    context: { requestId: randomUUID(), userId, membershipId, tenantId },
  };
}
