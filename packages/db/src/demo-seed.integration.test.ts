import { verifyPassword } from '@kulisa/auth/password';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { demoTenant, seedDemoTenant } from './seed-demo.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('seedDemoTenant', () => {
  const client = new Client({ connectionString: databaseUrl });

  beforeAll(async () => {
    await client.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  it('creates one synthetic demo tenant identity set when run twice', async () => {
    await seedDemoTenant(client);
    await seedDemoTenant(client);

    await expect(
      client.query("SELECT count(*)::int AS count FROM tenants WHERE name = 'Кулиса'"),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      client.query("SELECT count(*)::int AS count FROM users WHERE email = 'demo@demo.ru'"),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      client.query("SELECT count(*)::int AS count FROM memberships WHERE id = '00000000-0000-4000-8000-000000000004'"),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('sets a demo password that verifies and stays a single row across reseeding', async () => {
    await seedDemoTenant(client);
    await seedDemoTenant(client);

    const result = await client.query<{ password_hash: string }>(
      'SELECT password_hash FROM password_credentials WHERE user_id = $1',
      [demoTenant.userId],
    );

    expect(result.rows).toHaveLength(1);
    await expect(verifyPassword(demoTenant.adminPassword, result.rows[0]!.password_hash)).resolves.toBe(true);
  });
});
