import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresPermissionResolver } from './postgres-permission-resolver.js';
import { demoTenant, seedDemoTenant } from './seed-demo.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('PostgresPermissionResolver', () => {
  const client = new Client({ connectionString: databaseUrl });

  beforeAll(async () => {
    await client.connect();
    await client.query('BEGIN');
    await seedDemoTenant(client);
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  it('allows only a permission assigned to the active role in the same tenant', async () => {
    const resolver = new PostgresPermissionResolver(client);
    const context = {
      requestId: 'request-1',
      userId: demoTenant.userId,
      membershipId: demoTenant.membershipId,
      tenantId: demoTenant.tenantId,
    };

    await expect(resolver.hasPermission(context, 'platform.admin')).resolves.toBe(true);
    await expect(resolver.hasPermission(context, 'production.read')).resolves.toBe(false);
    await expect(
      resolver.hasPermission({ ...context, tenantId: '00000000-0000-4000-8000-000000000099' }, 'platform.admin'),
    ).resolves.toBe(false);
  });
});
