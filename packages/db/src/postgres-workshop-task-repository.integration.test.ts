import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresBudgetRepository } from './postgres-budget-repository.js';
import {
  PostgresWorkshopTaskRepository,
  WorkshopTaskAlreadyExistsError,
  WorkshopTaskAssigneeNotFoundError,
  WorkshopTaskBudgetItemNotFoundError,
  WorkshopTaskBudgetNotApprovedError,
  WorkshopTaskClosedError,
  WorkshopTaskInvalidTransitionError,
} from './postgres-workshop-task-repository.js';

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
      status: 'new',
      description: 'Сшить костюм',
      assigneeMembershipId: null,
    });
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

  it('walks a task through the full lifecycle: assign -> accept -> complete -> close', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await createReadyTask(client, tenant);

    const assigned = await taskRepository.assignTask(tenant.context, task.id, tenant.context.membershipId);
    expect(assigned).toMatchObject({ status: 'assigned', assigneeMembershipId: tenant.context.membershipId });

    const accepted = await taskRepository.acceptTask(tenant.context, task.id);
    expect(accepted).toMatchObject({ status: 'accepted' });

    const completed = await taskRepository.completeTask(tenant.context, task.id);
    expect(completed).toMatchObject({ status: 'completed' });
    expect(completed!.completedAt).not.toBeNull();

    const closed = await taskRepository.closeTask(tenant.context, task.id);
    expect(closed).toMatchObject({ status: 'closed' });

    await expect(
      client.query("SELECT action FROM audit_events WHERE subject_id = $1 AND action LIKE 'workshop_task.%' ORDER BY action", [task.id]),
    ).resolves.toMatchObject({
      rows: [
        { action: 'workshop_task.accepted' },
        { action: 'workshop_task.assigned' },
        { action: 'workshop_task.closed' },
        { action: 'workshop_task.completed' },
        { action: 'workshop_task.created' },
      ],
    });
  });

  it('rejects assigning a task that is not new', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await createReadyTask(client, tenant);
    await taskRepository.assignTask(tenant.context, task.id, tenant.context.membershipId);

    await expect(
      taskRepository.assignTask(tenant.context, task.id, tenant.context.membershipId),
    ).rejects.toBeInstanceOf(WorkshopTaskInvalidTransitionError);
  });

  it('rejects accepting a task that has not been assigned', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await createReadyTask(client, tenant);

    await expect(taskRepository.acceptTask(tenant.context, task.id)).rejects.toBeInstanceOf(WorkshopTaskInvalidTransitionError);
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

  it('rejects rescheduling a closed task', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const task = await createReadyTask(client, tenant);
    await taskRepository.assignTask(tenant.context, task.id, tenant.context.membershipId);
    await taskRepository.acceptTask(tenant.context, task.id);
    await taskRepository.completeTask(tenant.context, task.id);
    await taskRepository.closeTask(tenant.context, task.id);

    await expect(
      taskRepository.rescheduleTaskDeadline(tenant.context, task.id, '2026-12-24', 'Слишком поздно'),
    ).rejects.toBeInstanceOf(WorkshopTaskClosedError);
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
