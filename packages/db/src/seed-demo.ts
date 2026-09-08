import { fileURLToPath } from 'node:url';

import { hashPassword } from '@kulisa/auth/password';
import { Client, type QueryResult } from 'pg';

export const demoTenant = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  roleId: '00000000-0000-4000-8000-000000000002',
  userId: '00000000-0000-4000-8000-000000000003',
  membershipId: '00000000-0000-4000-8000-000000000004',
  permissionId: '00000000-0000-4000-8000-000000000005',
  name: 'Кулиса',
  adminEmail: 'demo@demo.ru',
  adminPassword: 'demo',
} as const;

export interface DatabaseClient {
  query(query: string, values?: readonly unknown[]): Promise<QueryResult>;
}

export async function seedDemoTenant(client: DatabaseClient): Promise<void> {
  await client.query(
    'INSERT INTO tenants (id, name, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()',
    [demoTenant.tenantId, demoTenant.name],
  );
  await client.query(
    'INSERT INTO users (id, email, "displayName", updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, "displayName" = EXCLUDED."displayName", updated_at = NOW()',
    [demoTenant.userId, demoTenant.adminEmail, 'Администратор демо'],
  );
  await client.query(
    'INSERT INTO roles (id, tenant_id, name, updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, name = EXCLUDED.name, updated_at = NOW()',
    [demoTenant.roleId, demoTenant.tenantId, 'theatre_admin'],
  );
  await client.query(
    "INSERT INTO memberships (id, tenant_id, user_id, role_id, status, updated_at) VALUES ($1, $2, $3, $4, 'ACTIVE', NOW()) ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, user_id = EXCLUDED.user_id, role_id = EXCLUDED.role_id, status = EXCLUDED.status, updated_at = NOW()",
    [
      demoTenant.membershipId,
      demoTenant.tenantId,
      demoTenant.userId,
      demoTenant.roleId,
    ],
  );
  await client.query(
    'INSERT INTO permissions (id, code, description) VALUES ($1, $2, $3) ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description',
    [demoTenant.permissionId, 'platform.admin', 'Pilot platform administration'],
  );
  await client.query(
    'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT (role_id, permission_id) DO NOTHING',
    [demoTenant.roleId, demoTenant.permissionId],
  );
  // Local/demo-only shortcut, not the controlled initial-admin provisioning flow
  // from docs/OPEN_QUESTIONS.md — resets the password hash on every seed run so
  // the demo credential stays predictable.
  await client.query(
    'INSERT INTO password_credentials (user_id, password_hash, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = NOW()',
    [demoTenant.userId, await hashPassword(demoTenant.adminPassword)],
  );
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await seedDemoTenant(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
