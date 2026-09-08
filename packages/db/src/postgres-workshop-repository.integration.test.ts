import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresWorkshopRepository, WorkshopNameAlreadyExistsError } from './postgres-workshop-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('PostgresWorkshopRepository', () => {
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

  it('creates a workshop and its audit event atomically within the tenant', async () => {
    const context = await createTenantContext(client, 'Tenant A');
    const repository = new PostgresWorkshopRepository(client);

    const workshop = await repository.createWorkshop(context, { name: 'Пошивочный цех' });

    expect(workshop).toMatchObject({ name: 'Пошивочный цех', isActive: true });
    await expect(
      client.query(
        "SELECT tenant_id, actor_membership_id, action, subject_type, subject_id FROM audit_events WHERE action = 'workshop.created' AND subject_id = $1",
        [workshop.id],
      ),
    ).resolves.toMatchObject({
      rows: [{
        tenant_id: context.tenantId,
        actor_membership_id: context.membershipId,
        action: 'workshop.created',
        subject_type: 'workshop',
        subject_id: workshop.id,
      }],
    });
  });

  it('rejects a duplicate workshop name within the same tenant', async () => {
    const context = await createTenantContext(client, 'Tenant A');
    const repository = new PostgresWorkshopRepository(client);
    await repository.createWorkshop(context, { name: 'Пошивочный цех' });

    await expect(
      repository.createWorkshop(context, { name: 'Пошивочный цех' }),
    ).rejects.toBeInstanceOf(WorkshopNameAlreadyExistsError);
  });

  it('allows the same workshop name in different tenants', async () => {
    const tenantA = await createTenantContext(client, 'Tenant A');
    const tenantB = await createTenantContext(client, 'Tenant B');
    const repository = new PostgresWorkshopRepository(client);

    await repository.createWorkshop(tenantA, { name: 'Пошивочный цех' });
    await expect(
      repository.createWorkshop(tenantB, { name: 'Пошивочный цех' }),
    ).resolves.toMatchObject({ name: 'Пошивочный цех' });
  });

  it('lists workshops scoped to the tenant, ordered by name', async () => {
    const tenantA = await createTenantContext(client, 'Tenant A');
    const tenantB = await createTenantContext(client, 'Tenant B');
    const repository = new PostgresWorkshopRepository(client);
    await repository.createWorkshop(tenantA, { name: 'Столярный цех' });
    await repository.createWorkshop(tenantA, { name: 'Гримёрный цех' });
    await repository.createWorkshop(tenantB, { name: 'Other tenant workshop' });

    const list = await repository.listWorkshops(tenantA);

    expect(list.map((workshop) => workshop.name)).toEqual(['Гримёрный цех', 'Столярный цех']);
  });
});

async function createTenantContext(client: Client, name: string) {
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
  return { requestId: randomUUID(), userId, membershipId, tenantId };
}
