import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  PostgresProductionRepository,
  ProductionProducerNotFoundError,
} from './postgres-production-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('PostgresProductionRepository', () => {
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

  it('creates a production with a neutral health status and its audit event', async () => {
    const tenant = await createTenantAdmin(client, 'Tenant A');
    const repository = new PostgresProductionRepository(client);

    const production = await repository.createProduction(tenant.context, {
      title: 'Ревизор',
      status: 'draft',
      premiereDate: '2026-12-01',
      producerMembershipId: tenant.membershipId,
    });

    expect(production).toMatchObject({
      title: 'Ревизор',
      status: 'draft',
      premiereDate: '2026-12-01',
      producerMembershipId: tenant.membershipId,
      healthStatus: 'neutral',
      healthReason: null,
    });
    await expect(
      client.query(
        "SELECT tenant_id, actor_membership_id, action, subject_type, subject_id FROM audit_events WHERE action = 'production.created' AND subject_id = $1",
        [production.id],
      ),
    ).resolves.toMatchObject({
      rows: [{
        tenant_id: tenant.context.tenantId,
        actor_membership_id: tenant.context.membershipId,
        action: 'production.created',
        subject_type: 'production',
        subject_id: production.id,
      }],
    });
  });

  it('creates a production without a premiere date or producer', async () => {
    const tenant = await createTenantAdmin(client, 'Tenant A');
    const repository = new PostgresProductionRepository(client);

    const production = await repository.createProduction(tenant.context, {
      title: 'Чайка',
      status: 'draft',
      premiereDate: null,
      producerMembershipId: null,
    });

    expect(production).toMatchObject({ premiereDate: null, producerMembershipId: null });
  });

  it('rejects creating a production with a producer from another tenant', async () => {
    const tenantA = await createTenantAdmin(client, 'Tenant A');
    const tenantB = await createTenantAdmin(client, 'Tenant B');
    const repository = new PostgresProductionRepository(client);

    await expect(
      repository.createProduction(tenantA.context, {
        title: 'Forged production',
        status: 'draft',
        premiereDate: null,
        producerMembershipId: tenantB.membershipId,
      }),
    ).rejects.toBeInstanceOf(ProductionProducerNotFoundError);

    await expect(
      client.query('SELECT count(*)::int AS count FROM productions WHERE tenant_id = $1', [tenantA.tenantId]),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it('gets a production by id within the tenant', async () => {
    const tenant = await createTenantAdmin(client, 'Tenant A');
    const repository = new PostgresProductionRepository(client);
    const created = await repository.createProduction(tenant.context, {
      title: 'Ревизор',
      status: 'draft',
      premiereDate: null,
      producerMembershipId: null,
    });

    await expect(repository.getProduction(tenant.context, created.id)).resolves.toEqual(created);
  });

  it('returns null for a production outside the tenant or that does not exist', async () => {
    const tenantA = await createTenantAdmin(client, 'Tenant A');
    const tenantB = await createTenantAdmin(client, 'Tenant B');
    const repository = new PostgresProductionRepository(client);
    const foreign = await repository.createProduction(tenantB.context, {
      title: 'Foreign show',
      status: 'draft',
      premiereDate: null,
      producerMembershipId: null,
    });

    await expect(repository.getProduction(tenantA.context, foreign.id)).resolves.toBeNull();
    await expect(repository.getProduction(tenantA.context, randomUUID())).resolves.toBeNull();
  });

  it('lists productions scoped to the tenant, ordered by title', async () => {
    const tenantA = await createTenantAdmin(client, 'Tenant A');
    const tenantB = await createTenantAdmin(client, 'Tenant B');
    const repository = new PostgresProductionRepository(client);

    await repository.createProduction(tenantA.context, { title: 'Чайка', status: 'draft', premiereDate: null, producerMembershipId: null });
    await repository.createProduction(tenantA.context, { title: 'Гроза', status: 'draft', premiereDate: null, producerMembershipId: null });
    await repository.createProduction(tenantB.context, { title: 'Other tenant show', status: 'draft', premiereDate: null, producerMembershipId: null });

    const list = await repository.listProductions(tenantA.context);

    expect(list.map((production) => production.title)).toEqual(['Гроза', 'Чайка']);
  });

  it('updates a production within its own tenant and records one audit event', async () => {
    const tenant = await createTenantAdmin(client, 'Tenant A');
    const repository = new PostgresProductionRepository(client);
    const production = await repository.createProduction(tenant.context, {
      title: 'Чайка',
      status: 'draft',
      premiereDate: null,
      producerMembershipId: null,
    });

    const updated = await repository.updateProduction(tenant.context, production.id, {
      title: 'Чайка (обновлено)',
      status: 'in_progress',
      premiereDate: '2027-01-15',
      producerMembershipId: tenant.membershipId,
    });

    expect(updated).toMatchObject({
      id: production.id,
      title: 'Чайка (обновлено)',
      status: 'in_progress',
      premiereDate: '2027-01-15',
      producerMembershipId: tenant.membershipId,
    });
    await expect(
      client.query("SELECT count(*)::int AS count FROM audit_events WHERE action = 'production.updated' AND subject_id = $1", [production.id]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('does not update a production from another tenant', async () => {
    const tenantA = await createTenantAdmin(client, 'Tenant A');
    const tenantB = await createTenantAdmin(client, 'Tenant B');
    const repository = new PostgresProductionRepository(client);
    const production = await repository.createProduction(tenantB.context, {
      title: 'Foreign show',
      status: 'draft',
      premiereDate: null,
      producerMembershipId: null,
    });

    const result = await repository.updateProduction(tenantA.context, production.id, {
      title: 'Forged title',
      status: 'draft',
      premiereDate: null,
      producerMembershipId: null,
    });

    expect(result).toBeNull();
    await expect(
      client.query('SELECT title FROM productions WHERE id = $1', [production.id]),
    ).resolves.toMatchObject({ rows: [{ title: 'Foreign show' }] });
  });

  it('rejects updating a production with a producer from another tenant', async () => {
    const tenantA = await createTenantAdmin(client, 'Tenant A');
    const tenantB = await createTenantAdmin(client, 'Tenant B');
    const repository = new PostgresProductionRepository(client);
    const production = await repository.createProduction(tenantA.context, {
      title: 'Ревизор',
      status: 'draft',
      premiereDate: null,
      producerMembershipId: null,
    });

    await expect(
      repository.updateProduction(tenantA.context, production.id, {
        title: 'Ревизор',
        status: 'draft',
        premiereDate: null,
        producerMembershipId: tenantB.membershipId,
      }),
    ).rejects.toBeInstanceOf(ProductionProducerNotFoundError);
  });
});

async function createTenantAdmin(client: Client, name: string) {
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
    membershipId,
    context: { requestId: randomUUID(), userId, membershipId, tenantId },
  };
}
