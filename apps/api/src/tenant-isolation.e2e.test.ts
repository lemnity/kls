import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalPasswordAuthService } from '@kulisa/auth/local-session';
import { hashPassword } from '@kulisa/auth/password';
import { PostgresPermissionResolver } from '@kulisa/db/permission-resolver';
import { PostgresRoleRepository } from '@kulisa/db/role-repository';

import { createApiApp } from './app.js';
import { PostgresLocalAuthRepository } from './postgres-local-auth-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('tenant isolation E2E', () => {
  const client = new Client({ connectionString: databaseUrl });

  beforeAll(async () => {
    await client.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  it('does not let an admin from tenant A read or rename a role from tenant B', async () => {
    const permissionResult = await client.query<{ id: string }>(
      `INSERT INTO permissions (id, code, description) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
       RETURNING id`,
      [randomUUID(), 'platform.admin', 'Tenant admin test permission'],
    );
    const permissionId = permissionResult.rows[0]!.id;
    const tenantA = await createTenantAdmin(client, 'Tenant A', permissionId);
    const tenantB = await createTenantAdmin(client, 'Tenant B', permissionId);
    const targetRoleId = randomUUID();
    await client.query(
      'INSERT INTO roles (id, tenant_id, name, updated_at) VALUES ($1, $2, $3, NOW())',
      [targetRoleId, tenantB.tenantId, 'workshop_lead'],
    );
    const app = await createApiApp({
      localPasswordAuthenticator: new LocalPasswordAuthService({
        repository: new PostgresLocalAuthRepository(client),
      }),
      permissionResolver: new PostgresPermissionResolver(client),
      roleRepository: new PostgresRoleRepository(client),
    });

    try {
      const tokenA = await login(app, tenantA.email, tenantA.password);
      const foreignRead = await app.inject({
        method: 'GET',
        url: `/v1/admin/roles/${targetRoleId}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const foreignRename = await app.inject({
        method: 'PATCH',
        url: `/v1/admin/roles/${targetRoleId}`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'forged_name' },
      });

      expect(foreignRead.statusCode).toBe(404);
      expect(foreignRename.statusCode).toBe(404);
      await expect(
        client.query('SELECT name FROM roles WHERE id = $1', [targetRoleId]),
      ).resolves.toMatchObject({ rows: [{ name: 'workshop_lead' }] });

      const tokenB = await login(app, tenantB.email, tenantB.password);
      const ownRename = await app.inject({
        method: 'PATCH',
        url: `/v1/admin/roles/${targetRoleId}`,
        headers: { authorization: `Bearer ${tokenB}` },
        payload: { name: 'technical_lead' },
      });

      expect(ownRename.statusCode).toBe(200);
      expect(ownRename.json()).toEqual({ id: targetRoleId, name: 'technical_lead' });
      await expect(
        client.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE tenant_id = $1 AND action = 'role.renamed' AND subject_id = $2",
          [tenantB.tenantId, targetRoleId],
        ),
      ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    } finally {
      await app.close();
    }
  });
});

async function createTenantAdmin(client: Client, name: string, permissionId: string) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const adminRoleId = randomUUID();
  const membershipId = randomUUID();
  const email = `${userId}@example.test`;
  const password = 'correct password';
  await client.query('INSERT INTO tenants (id, name, updated_at) VALUES ($1, $2, NOW())', [tenantId, name]);
  await client.query(
    'INSERT INTO users (id, email, "displayName", updated_at) VALUES ($1, $2, $3, NOW())',
    [userId, email, name],
  );
  await client.query(
    'INSERT INTO roles (id, tenant_id, name, updated_at) VALUES ($1, $2, $3, NOW())',
    [adminRoleId, tenantId, 'theatre_admin'],
  );
  await client.query(
    'INSERT INTO memberships (id, tenant_id, user_id, role_id, updated_at) VALUES ($1, $2, $3, $4, NOW())',
    [membershipId, tenantId, userId, adminRoleId],
  );
  await client.query(
    'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)',
    [adminRoleId, permissionId],
  );
  await client.query(
    'INSERT INTO password_credentials (user_id, password_hash, updated_at) VALUES ($1, $2, NOW())',
    [userId, await hashPassword(password)],
  );

  return { tenantId, email, password };
}

async function login(
  app: Awaited<ReturnType<typeof createApiApp>>,
  email: string,
  password: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email, password },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ accessToken: string }>().accessToken;
}
