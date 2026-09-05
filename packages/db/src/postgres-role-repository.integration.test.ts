import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresRoleRepository } from './postgres-role-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('PostgresRoleRepository', () => {
  const client = new Client({ connectionString: databaseUrl });

  beforeAll(async () => {
    await client.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  it('does not read or rename a role from another tenant', async () => {
    const tenantA = await createTenantIdentity(client, 'Tenant A');
    const tenantB = await createTenantIdentity(client, 'Tenant B');
    const roleId = randomUUID();
    await client.query(
      'INSERT INTO roles (id, tenant_id, name, updated_at) VALUES ($1, $2, $3, NOW())',
      [roleId, tenantB.tenantId, 'workshop_lead'],
    );
    const repository = new PostgresRoleRepository(client);

    await expect(repository.findById(tenantA.context, roleId)).resolves.toBeNull();
    await expect(
      repository.rename(tenantA.context, roleId, 'forged_name'),
    ).resolves.toBeNull();
    await expect(
      client.query('SELECT name FROM roles WHERE id = $1', [roleId]),
    ).resolves.toMatchObject({ rows: [{ name: 'workshop_lead' }] });
  });
});

async function createTenantIdentity(client: Client, name: string) {
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
    context: { requestId: randomUUID(), tenantId, userId, membershipId },
  };
}
