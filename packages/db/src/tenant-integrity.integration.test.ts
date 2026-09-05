import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('initial identity and audit database constraints', () => {
  const client = new Client({ connectionString: databaseUrl });

  beforeAll(async () => {
    await client.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  it('rejects a membership that links a role from another tenant', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const userId = randomUUID();
    const roleId = randomUUID();

    await client.query(
      'INSERT INTO tenants (id, name, updated_at) VALUES ($1, $2, NOW()), ($3, $4, NOW())',
      [tenantA, 'Tenant A', tenantB, 'Tenant B'],
    );
    await client.query(
      'INSERT INTO users (id, email, "displayName", updated_at) VALUES ($1, $2, $3, NOW())',
      [userId, `${userId}@example.test`, 'Test user'],
    );
    await client.query(
      'INSERT INTO roles (id, tenant_id, name, updated_at) VALUES ($1, $2, $3, NOW())',
      [roleId, tenantA, 'admin'],
    );

    await client.query('SAVEPOINT invalid_membership');
    await expect(
      client.query(
        'INSERT INTO memberships (id, tenant_id, user_id, role_id, updated_at) VALUES ($1, $2, $3, $4, NOW())',
        [randomUUID(), tenantB, userId, roleId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await client.query('ROLLBACK TO SAVEPOINT invalid_membership');
  });

  it('rejects direct updates to an audit event', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const roleId = randomUUID();
    const membershipId = randomUUID();
    const auditEventId = randomUUID();

    await client.query(
      'INSERT INTO tenants (id, name, updated_at) VALUES ($1, $2, NOW())',
      [tenantId, 'Audit tenant'],
    );
    await client.query(
      'INSERT INTO users (id, email, "displayName", updated_at) VALUES ($1, $2, $3, NOW())',
      [userId, `${userId}@example.test`, 'Audit user'],
    );
    await client.query(
      'INSERT INTO roles (id, tenant_id, name, updated_at) VALUES ($1, $2, $3, NOW())',
      [roleId, tenantId, 'admin'],
    );
    await client.query(
      'INSERT INTO memberships (id, tenant_id, user_id, role_id, updated_at) VALUES ($1, $2, $3, $4, NOW())',
      [membershipId, tenantId, userId, roleId],
    );
    await client.query(
      'INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [auditEventId, tenantId, membershipId, 'production.created', 'production', randomUUID()],
    );

    await client.query('SAVEPOINT immutable_audit_event');
    await expect(
      client.query('UPDATE audit_events SET action = $1 WHERE id = $2', [
        'production.changed',
        auditEventId,
      ]),
    ).rejects.toThrow('audit_events are append-only');
    await client.query('ROLLBACK TO SAVEPOINT immutable_audit_event');
  });

  it('rejects an audit actor membership from another tenant', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const userId = randomUUID();
    const roleId = randomUUID();
    const membershipId = randomUUID();

    await client.query(
      'INSERT INTO tenants (id, name, updated_at) VALUES ($1, $2, NOW()), ($3, $4, NOW())',
      [tenantA, 'Actor tenant A', tenantB, 'Actor tenant B'],
    );
    await client.query(
      'INSERT INTO users (id, email, "displayName", updated_at) VALUES ($1, $2, $3, NOW())',
      [userId, `${userId}@example.test`, 'Actor user'],
    );
    await client.query(
      'INSERT INTO roles (id, tenant_id, name, updated_at) VALUES ($1, $2, $3, NOW())',
      [roleId, tenantA, 'admin'],
    );
    await client.query(
      'INSERT INTO memberships (id, tenant_id, user_id, role_id, updated_at) VALUES ($1, $2, $3, $4, NOW())',
      [membershipId, tenantA, userId, roleId],
    );

    await client.query('SAVEPOINT invalid_audit_actor');
    await expect(
      client.query(
        'INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          randomUUID(),
          tenantB,
          membershipId,
          'production.created',
          'production',
          randomUUID(),
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await client.query('ROLLBACK TO SAVEPOINT invalid_audit_actor');
  });
});
