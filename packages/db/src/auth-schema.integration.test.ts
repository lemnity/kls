import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('local authentication database constraints', () => {
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

  it('allows one password credential per user', async () => {
    const userId = randomUUID();

    await client.query(
      'INSERT INTO users (id, email, "displayName", updated_at) VALUES ($1, $2, $3, NOW())',
      [userId, `${userId}@example.test`, 'Credential user'],
    );
    await client.query(
      'INSERT INTO password_credentials (user_id, password_hash, updated_at) VALUES ($1, $2, NOW())',
      [userId, 'scrypt$16384$8$1$salt$hash'],
    );

    await client.query('SAVEPOINT duplicate_password_credential');
    await expect(
      client.query(
        'INSERT INTO password_credentials (user_id, password_hash, updated_at) VALUES ($1, $2, NOW())',
        [userId, 'scrypt$16384$8$1$other-salt$other-hash'],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await client.query('ROLLBACK TO SAVEPOINT duplicate_password_credential');
  });

  it('rejects a session whose membership does not exist', async () => {
    await expect(
      client.query(
        'INSERT INTO auth_sessions (id, token_hash, membership_id, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL \'1 hour\')',
        [randomUUID(), 'a'.repeat(64), randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
