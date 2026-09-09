import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  BudgetGraphCycleError,
  BudgetGraphInvalidHierarchyError,
  BudgetGraphNodeNotFoundError,
  BudgetGraphNotAlternativeError,
  BudgetGraphRevisionConflictError,
  BudgetGraphVersionNotFoundError,
  BudgetGraphWorkshopNotFoundError,
  PostgresBudgetGraphRepository,
} from './postgres-budget-graph-repository.js';
import { PostgresWorkshopTaskRepository } from './postgres-workshop-task-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

const LAYOUT = { positionX: '0.00', positionY: '0.00', width: '160.00', height: '80.00' };

describeIntegration('PostgresBudgetGraphRepository', () => {
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

  it('creates a production root node with no parent', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new PostgresBudgetGraphRepository(client);

    const node = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      nodeType: 'production',
      title: 'Ревизор',
      plannedAmount: '100000.00',
      ...LAYOUT,
    });

    expect(node).toMatchObject({
      nodeType: 'production',
      parentId: null,
      title: 'Ревизор',
      plannedAmount: '100000.00',
      subtreeTotal: '100000.00',
      revision: 1,
    });
  });

  it('builds a production -> workshop -> work -> material branch and aggregates leaf totals up to the root', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new PostgresBudgetGraphRepository(client);

    const root = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      nodeType: 'production',
      title: 'Ревизор',
      plannedAmount: '0.00',
      ...LAYOUT,
    });
    const workshop = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      parentId: root.id,
      workshopId: fixture.workshopId,
      nodeType: 'workshop',
      title: 'Пошивочный цех',
      plannedAmount: '0.00',
      ...LAYOUT,
    });
    const work = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      parentId: workshop.id,
      nodeType: 'work',
      title: 'Пошив костюма',
      plannedAmount: '0.00',
      ...LAYOUT,
    });
    await repository.createNode(fixture.context, fixture.budgetVersionId, {
      parentId: work.id,
      nodeType: 'material',
      title: 'Ткань бархат',
      plannedAmount: '3000.00',
      ...LAYOUT,
    });
    await repository.createNode(fixture.context, fixture.budgetVersionId, {
      parentId: work.id,
      nodeType: 'material',
      title: 'Молнии',
      plannedAmount: '500.00',
      ...LAYOUT,
    });

    const nodes = await repository.listNodes(fixture.context, fixture.budgetVersionId);
    const byId = new Map(nodes.map((node) => [node.id, node]));

    expect(byId.get(work.id)?.subtreeTotal).toBe('3500.00');
    expect(byId.get(workshop.id)?.subtreeTotal).toBe('3500.00');
    expect(byId.get(root.id)?.subtreeTotal).toBe('3500.00');
  });

  it('rejects a node type that does not match its parent level', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new PostgresBudgetGraphRepository(client);
    const root = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      nodeType: 'production',
      title: 'Ревизор',
      plannedAmount: '0.00',
      ...LAYOUT,
    });

    await expect(
      repository.createNode(fixture.context, fixture.budgetVersionId, {
        parentId: root.id,
        nodeType: 'work',
        title: 'Skips workshop level',
        plannedAmount: '0.00',
        ...LAYOUT,
      }),
    ).rejects.toBeInstanceOf(BudgetGraphInvalidHierarchyError);
  });

  it('rejects a root node that is not a production node', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new PostgresBudgetGraphRepository(client);

    await expect(
      repository.createNode(fixture.context, fixture.budgetVersionId, {
        nodeType: 'workshop',
        title: 'No parent',
        plannedAmount: '0.00',
        ...LAYOUT,
      }),
    ).rejects.toBeInstanceOf(BudgetGraphInvalidHierarchyError);
  });

  it('rejects creating a node for a budget version outside the tenant', async () => {
    const fixtureA = await createFixture(client, 'Tenant A');
    const fixtureB = await createFixture(client, 'Tenant B');
    const repository = new PostgresBudgetGraphRepository(client);

    await expect(
      repository.createNode(fixtureA.context, fixtureB.budgetVersionId, {
        nodeType: 'production',
        title: 'Forged',
        plannedAmount: '0.00',
        ...LAYOUT,
      }),
    ).rejects.toBeInstanceOf(BudgetGraphVersionNotFoundError);
  });

  it('rejects a workshop node with a workshopId from another tenant', async () => {
    const fixtureA = await createFixture(client, 'Tenant A');
    const fixtureB = await createFixture(client, 'Tenant B');
    const repository = new PostgresBudgetGraphRepository(client);
    const root = await repository.createNode(fixtureA.context, fixtureA.budgetVersionId, {
      nodeType: 'production',
      title: 'Ревизор',
      plannedAmount: '0.00',
      ...LAYOUT,
    });

    await expect(
      repository.createNode(fixtureA.context, fixtureA.budgetVersionId, {
        parentId: root.id,
        workshopId: fixtureB.workshopId,
        nodeType: 'workshop',
        title: 'Пошивочный цех',
        plannedAmount: '0.00',
        ...LAYOUT,
      }),
    ).rejects.toBeInstanceOf(BudgetGraphWorkshopNotFoundError);
  });

  it('moves a node and increments its revision, rejecting a stale expectedRevision', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new PostgresBudgetGraphRepository(client);
    const node = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      nodeType: 'production',
      title: 'Ревизор',
      plannedAmount: '0.00',
      ...LAYOUT,
    });

    const moved = await repository.moveNode(fixture.context, node.id, 1, {
      positionX: '50.00',
      positionY: '75.00',
      width: '200.00',
      height: '100.00',
    });
    expect(moved).toMatchObject({ positionX: '50.00', positionY: '75.00', revision: 2 });

    await expect(
      repository.moveNode(fixture.context, node.id, 1, LAYOUT),
    ).rejects.toBeInstanceOf(BudgetGraphRevisionConflictError);
  });

  it('updates a node title and planned amount, recomputing subtree totals, rejecting a stale expectedRevision', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new PostgresBudgetGraphRepository(client);
    const node = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      nodeType: 'production',
      title: 'Ревизор',
      plannedAmount: '1000.00',
      ...LAYOUT,
    });

    const updated = await repository.updateNodeDetails(fixture.context, node.id, 1, {
      title: 'Ревизор (обновлено)',
      plannedAmount: '2500.00',
    });
    expect(updated).toMatchObject({
      title: 'Ревизор (обновлено)',
      plannedAmount: '2500.00',
      subtreeTotal: '2500.00',
      revision: 2,
    });

    await expect(
      repository.updateNodeDetails(fixture.context, node.id, 1, { title: 'X', plannedAmount: '0.00' }),
    ).rejects.toBeInstanceOf(BudgetGraphRevisionConflictError);
  });

  it('returns null when updating details of a node outside the tenant', async () => {
    const tenantA = await createFixture(client, 'Tenant A');
    const tenantB = await createFixture(client, 'Tenant B');
    const repository = new PostgresBudgetGraphRepository(client);
    const foreignNode = await repository.createNode(tenantB.context, tenantB.budgetVersionId, {
      nodeType: 'production',
      title: 'Foreign',
      plannedAmount: '0.00',
      ...LAYOUT,
    });

    await expect(
      repository.updateNodeDetails(tenantA.context, foreignNode.id, 1, { title: 'X', plannedAmount: '0.00' }),
    ).resolves.toBeNull();
  });

  it('reparents a node to a sibling branch of the same level, rejecting a cycle', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new PostgresBudgetGraphRepository(client);
    const root = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      nodeType: 'production',
      title: 'Ревизор',
      plannedAmount: '0.00',
      ...LAYOUT,
    });
    const workshopOne = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      parentId: root.id,
      workshopId: fixture.workshopId,
      nodeType: 'workshop',
      title: 'Цех 1',
      plannedAmount: '0.00',
      ...LAYOUT,
    });
    const work = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      parentId: workshopOne.id,
      nodeType: 'work',
      title: 'Работа',
      plannedAmount: '0.00',
      ...LAYOUT,
    });

    // cycle: root cannot become a child of its own descendant
    await expect(
      repository.reparentNode(fixture.context, root.id, 1, work.id),
    ).rejects.toBeInstanceOf(BudgetGraphCycleError);

    // self-parent
    await expect(
      repository.reparentNode(fixture.context, root.id, 1, root.id),
    ).rejects.toBeInstanceOf(BudgetGraphCycleError);
  });

  it('deletes a node and cascades to its whole subtree', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new PostgresBudgetGraphRepository(client);
    const root = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      nodeType: 'production',
      title: 'Ревизор',
      plannedAmount: '0.00',
      ...LAYOUT,
    });
    const workshop = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      parentId: root.id,
      workshopId: fixture.workshopId,
      nodeType: 'workshop',
      title: 'Цех',
      plannedAmount: '0.00',
      ...LAYOUT,
    });
    const work = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      parentId: workshop.id,
      nodeType: 'work',
      title: 'Работа',
      plannedAmount: '0.00',
      ...LAYOUT,
    });

    const result = await repository.deleteNode(fixture.context, workshop.id, 1);

    expect(result?.deletedIds.sort()).toEqual([work.id, workshop.id].sort());
    const remaining = await repository.listNodes(fixture.context, fixture.budgetVersionId);
    expect(remaining.map((node) => node.id)).toEqual([root.id]);
    // Scoped to this test's own node — kulisa_dev is a shared, persistent
    // dev database with real concurrent usage, so an unscoped count(*)
    // here would also pick up audit events from outside this test.
    await expect(
      client.query(
        "SELECT count(*)::int AS count FROM audit_events WHERE action = 'budget_graph_node.deleted' AND subject_id = $1",
        [workshop.id],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('returns null for move/reparent/delete on a node outside the tenant', async () => {
    const fixtureA = await createFixture(client, 'Tenant A');
    const fixtureB = await createFixture(client, 'Tenant B');
    const repository = new PostgresBudgetGraphRepository(client);
    const foreignRoot = await repository.createNode(fixtureB.context, fixtureB.budgetVersionId, {
      nodeType: 'production',
      title: 'Foreign',
      plannedAmount: '0.00',
      ...LAYOUT,
    });

    await expect(repository.moveNode(fixtureA.context, foreignRoot.id, 1, LAYOUT)).resolves.toBeNull();
    await expect(repository.reparentNode(fixtureA.context, foreignRoot.id, 1, null)).resolves.toBeNull();
    await expect(repository.deleteNode(fixtureA.context, foreignRoot.id, 1)).resolves.toBeNull();
  });

  it('rejects a node not found error for an unknown parentId', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new PostgresBudgetGraphRepository(client);

    await expect(
      repository.createNode(fixture.context, fixture.budgetVersionId, {
        parentId: randomUUID(),
        nodeType: 'workshop',
        title: 'Orphan',
        plannedAmount: '0.00',
        ...LAYOUT,
      }),
    ).rejects.toBeInstanceOf(BudgetGraphNodeNotFoundError);
  });

  it('exposes null approvedTotal for non-workshop nodes, and 0.00 for a workshop node with no approved tasks', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new PostgresBudgetGraphRepository(client);
    const root = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      nodeType: 'production',
      title: 'Ревизор',
      plannedAmount: '0.00',
      ...LAYOUT,
    });
    const workshop = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      parentId: root.id,
      workshopId: fixture.workshopId,
      nodeType: 'workshop',
      title: 'Цех сборки',
      plannedAmount: '0.00',
      ...LAYOUT,
    });

    const nodes = await repository.listNodes(fixture.context, fixture.budgetVersionId);
    const byId = new Map(nodes.map((node) => [node.id, node]));

    expect(byId.get(root.id)?.approvedTotal).toBeNull();
    expect(byId.get(workshop.id)?.approvedTotal).toBe('0.00');
  });

  it('sums only approved graph-node tasks into approvedTotal, ignoring pending and rejected ones', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new PostgresBudgetGraphRepository(client);
    const taskRepository = new PostgresWorkshopTaskRepository(client);
    const root = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      nodeType: 'production',
      title: 'Ревизор',
      plannedAmount: '0.00',
      ...LAYOUT,
    });
    const workshop = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      parentId: root.id,
      workshopId: fixture.workshopId,
      nodeType: 'workshop',
      title: 'Цех сборки',
      plannedAmount: '0.00',
      ...LAYOUT,
    });

    const approvedTask = await taskRepository.createTaskForGraphNode(fixture.context, workshop.id, {
      description: 'Смета на стулья',
      plannedAmount: '1500.50',
      assigneeMembershipIds: [fixture.context.membershipId],
    });
    await taskRepository.recordLeadDecision(fixture.context, approvedTask.id, 'approved');

    const rejectedTask = await taskRepository.createTaskForGraphNode(fixture.context, workshop.id, {
      description: 'Смета на краску',
      plannedAmount: '999.00',
      assigneeMembershipIds: [fixture.context.membershipId],
    });
    await taskRepository.recordLeadDecision(fixture.context, rejectedTask.id, 'rejected');

    await taskRepository.createTaskForGraphNode(fixture.context, workshop.id, {
      description: 'Смета на гвозди (ещё не решено)',
      plannedAmount: '250.00',
      assigneeMembershipIds: [fixture.context.membershipId],
    });

    const nodes = await repository.listNodes(fixture.context, fixture.budgetVersionId);
    const found = nodes.find((node) => node.id === workshop.id);

    expect(found?.approvedTotal).toBe('1500.50');
  });

  it('copies a branch as an alternative with isolated new ids, and excludes the inactive one from the parent total', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new PostgresBudgetGraphRepository(client);
    const root = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      nodeType: 'production',
      title: 'Ревизор',
      plannedAmount: '0.00',
      ...LAYOUT,
    });
    const workshop = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      parentId: root.id,
      workshopId: fixture.workshopId,
      nodeType: 'workshop',
      title: 'Цех (дёшево)',
      plannedAmount: '0.00',
      ...LAYOUT,
    });
    const work = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      parentId: workshop.id,
      nodeType: 'work',
      title: 'Работа',
      plannedAmount: '0.00',
      ...LAYOUT,
    });
    await repository.createNode(fixture.context, fixture.budgetVersionId, {
      parentId: work.id,
      nodeType: 'material',
      title: 'Дешёвая ткань',
      plannedAmount: '1000.00',
      ...LAYOUT,
    });

    const afterCopy = await repository.copyBranchAsAlternative(fixture.context, workshop.id, 1);
    expect(afterCopy).not.toBeNull();

    const clonedRoot = afterCopy!.find((node) => node.title === 'Цех (дёшево)' && node.id !== workshop.id);
    expect(clonedRoot).toBeDefined();
    expect(clonedRoot!.id).not.toBe(workshop.id);
    expect(clonedRoot!.parentId).toBe(root.id);
    expect(clonedRoot!.isActive).toBe(false);
    expect(clonedRoot!.subtreeTotal).toBe('1000.00');

    const updatedOriginal = afterCopy!.find((node) => node.id === workshop.id)!;
    expect(updatedOriginal.alternativeGroupId).not.toBeNull();
    expect(updatedOriginal.alternativeGroupId).toBe(clonedRoot!.alternativeGroupId);
    expect(updatedOriginal.isActive).toBe(true);
    expect(updatedOriginal.revision).toBe(2);

    // Clone's own subtree (material) got fresh ids, not reused from the original.
    const clonedMaterial = afterCopy!.find(
      (node) => node.nodeType === 'material' && node.parentId !== work.id && node.title === 'Дешёвая ткань',
    );
    expect(clonedMaterial).toBeDefined();

    // Root's total still comes only from the (active) original branch —
    // the inactive clone's material leaf is not double-counted.
    const rootTotals = afterCopy!.find((node) => node.id === root.id)!;
    expect(rootTotals.subtreeTotal).toBe('1000.00');
  });

  it('activating an alternative switches which branch counts toward the ancestor total', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new PostgresBudgetGraphRepository(client);
    const root = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      nodeType: 'production',
      title: 'Ревизор',
      plannedAmount: '0.00',
      ...LAYOUT,
    });
    const workshop = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      parentId: root.id,
      workshopId: fixture.workshopId,
      nodeType: 'workshop',
      title: 'Цех',
      plannedAmount: '1000.00',
      ...LAYOUT,
    });

    const afterCopy = await repository.copyBranchAsAlternative(fixture.context, workshop.id, 1);
    const clone = afterCopy!.find((node) => node.id !== workshop.id && node.title === 'Цех')!;

    // Update the clone to a different amount so the two alternatives are distinguishable.
    await repository.updateNodeDetails(fixture.context, clone.id, clone.revision, {
      title: 'Цех (дорого)',
      plannedAmount: '5000.00',
    });

    const beforeActivation = await repository.listNodes(fixture.context, fixture.budgetVersionId);
    expect(beforeActivation.find((node) => node.id === root.id)?.subtreeTotal).toBe('1000.00');
    expect(beforeActivation.find((node) => node.id === clone.id)?.subtreeTotal).toBe('5000.00');

    const afterActivation = await repository.activateAlternative(fixture.context, clone.id);
    expect(afterActivation).not.toBeNull();

    const rootAfter = afterActivation!.find((node) => node.id === root.id)!;
    const originalAfter = afterActivation!.find((node) => node.id === workshop.id)!;
    const cloneAfter = afterActivation!.find((node) => node.id === clone.id)!;

    expect(rootAfter.subtreeTotal).toBe('5000.00');
    expect(originalAfter.isActive).toBe(false);
    expect(cloneAfter.isActive).toBe(true);
    // The now-inactive original still reports its own correct total.
    expect(originalAfter.subtreeTotal).toBe('1000.00');

    await expect(
      client.query("SELECT count(*)::int AS count FROM audit_events WHERE action = 'budget_graph_node.alternative_activated' AND subject_id = $1", [clone.id]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('rejects activating an alternative on a node that has no alternative group', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new PostgresBudgetGraphRepository(client);
    const root = await repository.createNode(fixture.context, fixture.budgetVersionId, {
      nodeType: 'production',
      title: 'Ревизор',
      plannedAmount: '0.00',
      ...LAYOUT,
    });

    await expect(
      repository.activateAlternative(fixture.context, root.id),
    ).rejects.toBeInstanceOf(BudgetGraphNotAlternativeError);
  });

  it('returns null when copying a branch outside the tenant', async () => {
    const fixtureA = await createFixture(client, 'Tenant A');
    const fixtureB = await createFixture(client, 'Tenant B');
    const repository = new PostgresBudgetGraphRepository(client);
    const foreignRoot = await repository.createNode(fixtureB.context, fixtureB.budgetVersionId, {
      nodeType: 'production',
      title: 'Foreign',
      plannedAmount: '0.00',
      ...LAYOUT,
    });

    await expect(repository.copyBranchAsAlternative(fixtureA.context, foreignRoot.id, 1)).resolves.toBeNull();
    await expect(repository.activateAlternative(fixtureA.context, foreignRoot.id)).resolves.toBeNull();
  });
});

async function createFixture(client: Client, name: string) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const roleId = randomUUID();
  const membershipId = randomUUID();
  const productionId = randomUUID();
  const workshopId = randomUUID();
  const budgetId = randomUUID();
  const budgetVersionId = randomUUID();

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
  await client.query(
    "INSERT INTO budgets (id, tenant_id, production_id, status, updated_at) VALUES ($1, $2, $3, 'PRELIMINARY', NOW())",
    [budgetId, tenantId, productionId],
  );
  await client.query(
    'INSERT INTO budget_versions (id, tenant_id, budget_id, revision, created_by_membership_id) VALUES ($1, $2, $3, 1, $4)',
    [budgetVersionId, tenantId, budgetId, membershipId],
  );

  return {
    tenantId,
    workshopId,
    budgetVersionId,
    context: { requestId: randomUUID(), userId, membershipId, tenantId },
  };
}
