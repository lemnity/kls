import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { LocalPasswordAuthService } from '@europa/auth/local-session';
import { hashPassword } from '@europa/auth/password';

import { PostgresLocalAuthRepository } from './postgres-local-auth-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('PostgresLocalAuthRepository', () => {
  const client = new Client({ connectionString: databaseUrl });
  const repository = new PostgresLocalAuthRepository(client);

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

  it('loads one user credential, stores only a token hash, and resolves an active membership', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const roleId = randomUUID();
    const membershipId = randomUUID();

    await client.query(
      'INSERT INTO tenants (id, name, updated_at) VALUES ($1, $2, NOW())',
      [tenantId, 'Auth tenant'],
    );
    await client.query(
      'INSERT INTO users (id, email, "displayName", updated_at) VALUES ($1, $2, $3, NOW())',
      [userId, 'admin@example.test', 'Admin'],
    );
    await client.query(
      'INSERT INTO roles (id, tenant_id, name, updated_at) VALUES ($1, $2, $3, NOW())',
      [roleId, tenantId, 'admin'],
    );
    await client.query(
      'INSERT INTO memberships (id, tenant_id, user_id, role_id, updated_at) VALUES ($1, $2, $3, $4, NOW())',
      [membershipId, tenantId, userId, roleId],
    );
    const passwordHash = await hashPassword('correct password');
    await client.query(
      'INSERT INTO password_credentials (user_id, password_hash, updated_at) VALUES ($1, $2, NOW())',
      [userId, passwordHash],
    );

    const credential = await repository.findCredentialByEmail('admin@example.test');
    const auth = new LocalPasswordAuthService({ repository });
    const login = await auth.login({
      email: 'admin@example.test',
      password: 'correct password',
    });

    await expect(auth.authenticate(login!.accessToken)).resolves.toEqual({
      userId,
      membership: {
        id: membershipId,
        tenantId,
        userId,
        isActive: true,
      },
    });
    expect(credential).toEqual({
      passwordHash,
      memberships: [
        {
          id: membershipId,
          tenantId,
          userId,
          isActive: true,
        },
      ],
    });
  });
});
