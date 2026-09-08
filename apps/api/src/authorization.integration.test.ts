import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalPasswordAuthService } from '@kulisa/auth/local-session';
import { hashPassword } from '@kulisa/auth/password';
import { PostgresPermissionResolver } from '@kulisa/db/permission-resolver';

import { createApiApp } from './app.js';
import { PostgresLocalAuthRepository } from './postgres-local-auth-repository.js';
import { demoTenant, seedDemoTenant } from '../../../packages/db/src/seed-demo.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('API authorization', () => {
  const client = new Client({ connectionString: databaseUrl });

  beforeAll(async () => {
    await client.connect();
    await client.query('BEGIN');
    await seedDemoTenant(client);
    await client.query(
      `INSERT INTO password_credentials (user_id, password_hash, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = NOW()`,
      [demoTenant.userId, await hashPassword('correct password')],
    );
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  it('allows the demo admin through backend permission authorization after login', async () => {
    const localPasswordAuthenticator = new LocalPasswordAuthService({
      repository: new PostgresLocalAuthRepository(client),
    });
    const app = await createApiApp({
      localPasswordAuthenticator,
      permissionResolver: new PostgresPermissionResolver(client),
    });

    try {
      const login = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: demoTenant.adminEmail, password: 'correct password' },
      });
      const { accessToken } = login.json<{ accessToken: string }>();
      const adminSession = await app.inject({
        method: 'GET',
        url: '/v1/admin/session',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(login.statusCode).toBe(201);
      expect(adminSession.statusCode).toBe(200);
      expect(adminSession.json()).toMatchObject({
        tenantId: demoTenant.tenantId,
        membershipId: demoTenant.membershipId,
      });
    } finally {
      await app.close();
    }
  });
});
