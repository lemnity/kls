import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  BudgetAlreadyApprovedError,
  BudgetAlreadyExistsError,
  BudgetProductionNotFoundError,
  BudgetSectionWorkshopNotFoundError,
  PostgresBudgetRepository,
} from './postgres-budget-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('PostgresBudgetRepository', () => {
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

  it('creates a budget with server-computed totals and one audit event', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const repository = new PostgresBudgetRepository(client);

    const budget = await repository.createBudget(tenant.context, {
      productionId: tenant.productionId,
      sections: [
        {
          workshopId: tenant.workshopId,
          title: 'Пошивочный цех',
          items: [
            { description: 'Ткань', quantity: '12.5', unit: 'м', unitPrice: '450.00' },
            { description: 'Нитки', quantity: '3', unit: 'шт', unitPrice: '90.00' },
          ],
        },
      ],
    });

    expect(budget.status).toBe('PRELIMINARY');
    expect(budget.revision).toBe(1);
    expect(budget.sections).toHaveLength(1);
    expect(budget.sections[0]).toMatchObject({
      workshopId: tenant.workshopId,
      title: 'Пошивочный цех',
      subtotal: '5895.00', // 12.5*450.00=5625.00 + 3*90.00=270.00
    });
    expect(budget.sections[0]!.items).toEqual([
      expect.objectContaining({ description: 'Ткань', total: '5625.00' }),
      expect.objectContaining({ description: 'Нитки', total: '270.00' }),
    ]);
    expect(budget.total).toBe('5895.00');

    await expect(
      client.query(
        "SELECT tenant_id, actor_membership_id, action, subject_type, subject_id FROM audit_events WHERE action = 'budget.created' AND subject_id = $1",
        [budget.id],
      ),
    ).resolves.toMatchObject({
      rows: [{
        tenant_id: tenant.context.tenantId,
        actor_membership_id: tenant.context.membershipId,
        action: 'budget.created',
        subject_type: 'budget',
        subject_id: budget.id,
      }],
    });
  });

  it('creates a budget with no sections', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const repository = new PostgresBudgetRepository(client);

    const budget = await repository.createBudget(tenant.context, {
      productionId: tenant.productionId,
      sections: [],
    });

    expect(budget.sections).toEqual([]);
    expect(budget.total).toBe('0.00');
  });

  it('rejects creating a budget for a production outside the tenant', async () => {
    const tenantA = await createTenantFixture(client, 'Tenant A');
    const tenantB = await createTenantFixture(client, 'Tenant B');
    const repository = new PostgresBudgetRepository(client);

    await expect(
      repository.createBudget(tenantA.context, { productionId: tenantB.productionId, sections: [] }),
    ).rejects.toBeInstanceOf(BudgetProductionNotFoundError);
  });

  it('rejects a second budget for the same production', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const repository = new PostgresBudgetRepository(client);
    await repository.createBudget(tenant.context, { productionId: tenant.productionId, sections: [] });

    await expect(
      repository.createBudget(tenant.context, { productionId: tenant.productionId, sections: [] }),
    ).rejects.toBeInstanceOf(BudgetAlreadyExistsError);
  });

  it('rejects a section workshop from another tenant, without creating the budget', async () => {
    const tenantA = await createTenantFixture(client, 'Tenant A');
    const tenantB = await createTenantFixture(client, 'Tenant B');
    const repository = new PostgresBudgetRepository(client);

    await expect(
      repository.createBudget(tenantA.context, {
        productionId: tenantA.productionId,
        sections: [{ workshopId: tenantB.workshopId, title: 'Forged section', items: [] }],
      }),
    ).rejects.toBeInstanceOf(BudgetSectionWorkshopNotFoundError);

    await expect(
      client.query('SELECT count(*)::int AS count FROM budgets WHERE tenant_id = $1', [tenantA.context.tenantId]),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it('returns null for a budget outside the tenant', async () => {
    const tenantA = await createTenantFixture(client, 'Tenant A');
    const tenantB = await createTenantFixture(client, 'Tenant B');
    const repository = new PostgresBudgetRepository(client);
    const budget = await repository.createBudget(tenantB.context, { productionId: tenantB.productionId, sections: [] });

    await expect(repository.getBudget(tenantA.context, budget.id)).resolves.toBeNull();
  });

  it('finds a budget by production id within the tenant', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const repository = new PostgresBudgetRepository(client);
    const created = await repository.createBudget(tenant.context, { productionId: tenant.productionId, sections: [] });

    await expect(repository.getBudgetByProductionId(tenant.context, tenant.productionId)).resolves.toMatchObject({
      id: created.id,
    });
  });

  it('returns null when looking up a budget by production id outside the tenant', async () => {
    const tenantA = await createTenantFixture(client, 'Tenant A');
    const tenantB = await createTenantFixture(client, 'Tenant B');
    const repository = new PostgresBudgetRepository(client);
    await repository.createBudget(tenantB.context, { productionId: tenantB.productionId, sections: [] });

    await expect(repository.getBudgetByProductionId(tenantA.context, tenantB.productionId)).resolves.toBeNull();
  });

  it('rounds fractional quantity totals half-up, consistently between item and subtotal', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const repository = new PostgresBudgetRepository(client);

    const budget = await repository.createBudget(tenant.context, {
      productionId: tenant.productionId,
      sections: [
        {
          workshopId: tenant.workshopId,
          title: 'Бутафорский цех',
          items: [{ description: 'Материал', quantity: '0.333', unit: 'кг', unitPrice: '3.00' }],
        },
      ],
    });

    expect(budget.sections[0]!.items[0]!.total).toBe('1.00');
    expect(budget.sections[0]!.subtotal).toBe('1.00');
    expect(budget.total).toBe('1.00');
  });

  it('approves a budget and records one audit event', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const repository = new PostgresBudgetRepository(client);
    const budget = await repository.createBudget(tenant.context, { productionId: tenant.productionId, sections: [] });

    const approved = await repository.approveBudget(tenant.context, budget.id);

    expect(approved).toMatchObject({ id: budget.id, status: 'APPROVED' });
    await expect(
      client.query("SELECT count(*)::int AS count FROM audit_events WHERE action = 'budget.approved' AND subject_id = $1", [budget.id]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('rejects approving an already-approved budget', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const repository = new PostgresBudgetRepository(client);
    const budget = await repository.createBudget(tenant.context, { productionId: tenant.productionId, sections: [] });
    await repository.approveBudget(tenant.context, budget.id);

    await expect(repository.approveBudget(tenant.context, budget.id)).rejects.toBeInstanceOf(BudgetAlreadyApprovedError);
  });

  it('returns null when approving a budget outside the tenant', async () => {
    const tenantA = await createTenantFixture(client, 'Tenant A');
    const tenantB = await createTenantFixture(client, 'Tenant B');
    const repository = new PostgresBudgetRepository(client);
    const budget = await repository.createBudget(tenantB.context, { productionId: tenantB.productionId, sections: [] });

    await expect(repository.approveBudget(tenantA.context, budget.id)).resolves.toBeNull();
  });
});

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
