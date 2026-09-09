import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresBudgetTemplateRepository } from './postgres-budget-template-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('PostgresBudgetTemplateRepository', () => {
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

  it('creates a template and its audit event', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const repository = new PostgresBudgetTemplateRepository(client);

    const template = await repository.createTemplate(tenant.context, {
      name: 'Стандартный цех пошива',
      nodeType: 'workshop',
      plannedAmount: '50000.00',
    });

    expect(template).toMatchObject({
      name: 'Стандартный цех пошива',
      nodeType: 'workshop',
      plannedAmount: '50000.00',
    });
    await expect(
      client.query(
        "SELECT tenant_id, actor_membership_id, action FROM audit_events WHERE action = 'budget_template.created' AND subject_id = $1",
        [template.id],
      ),
    ).resolves.toMatchObject({
      rows: [{
        tenant_id: tenant.context.tenantId,
        actor_membership_id: tenant.context.membershipId,
        action: 'budget_template.created',
      }],
    });
  });

  it('lists templates scoped to the tenant', async () => {
    const tenantA = await createTenantFixture(client, 'Tenant A');
    const tenantB = await createTenantFixture(client, 'Tenant B');
    const repository = new PostgresBudgetTemplateRepository(client);
    await repository.createTemplate(tenantA.context, { name: 'Первый', nodeType: 'work', plannedAmount: '100.00' });
    await repository.createTemplate(tenantA.context, { name: 'Второй', nodeType: 'material', plannedAmount: '200.00' });
    await repository.createTemplate(tenantB.context, { name: 'Чужой', nodeType: 'work', plannedAmount: '999.00' });

    const listA = await repository.listTemplates(tenantA.context);
    const listB = await repository.listTemplates(tenantB.context);

    // Order isn't a promised contract here (two creates can land in the same
    // millisecond, and there's no dedicated sequence column) — just assert
    // tenant scoping and membership.
    expect(listA.map((t) => t.name).sort()).toEqual(['Второй', 'Первый']);
    expect(listB.map((t) => t.name)).toEqual(['Чужой']);
  });

  it('deletes a template and records an audit event, returning false for an unknown id', async () => {
    const tenant = await createTenantFixture(client, 'Tenant A');
    const repository = new PostgresBudgetTemplateRepository(client);
    const template = await repository.createTemplate(tenant.context, {
      name: 'Удаляемый',
      nodeType: 'material',
      plannedAmount: '10.00',
    });

    const deleted = await repository.deleteTemplate(tenant.context, template.id);
    const deletedAgain = await repository.deleteTemplate(tenant.context, template.id);
    const deletedUnknown = await repository.deleteTemplate(tenant.context, randomUUID());

    expect(deleted).toBe(true);
    expect(deletedAgain).toBe(false);
    expect(deletedUnknown).toBe(false);
    await expect(repository.listTemplates(tenant.context)).resolves.toEqual([]);
    await expect(
      client.query("SELECT count(*)::int AS count FROM audit_events WHERE action = 'budget_template.deleted' AND subject_id = $1", [template.id]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('does not delete a template belonging to another tenant', async () => {
    const tenantA = await createTenantFixture(client, 'Tenant A');
    const tenantB = await createTenantFixture(client, 'Tenant B');
    const repository = new PostgresBudgetTemplateRepository(client);
    const template = await repository.createTemplate(tenantA.context, {
      name: 'Тенант А',
      nodeType: 'work',
      plannedAmount: '1.00',
    });

    const deleted = await repository.deleteTemplate(tenantB.context, template.id);

    expect(deleted).toBe(false);
    await expect(repository.listTemplates(tenantA.context)).resolves.toHaveLength(1);
  });
});

async function createTenantFixture(client: Client, name: string) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const roleId = randomUUID();
  const membershipId = randomUUID();

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

  return {
    tenantId,
    context: { requestId: randomUUID(), userId, membershipId, tenantId },
  };
}
