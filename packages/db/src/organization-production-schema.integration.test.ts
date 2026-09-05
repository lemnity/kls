import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('organization and production database constraints', () => {
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

  it('rejects an org unit whose parent belongs to another tenant', async () => {
    const tenantA = await createTenantMembership(client, 'Tenant A');
    const tenantB = await createTenantMembership(client, 'Tenant B');
    const parentId = randomUUID();
    await client.query(
      'INSERT INTO org_units (id, tenant_id, name, type, updated_at) VALUES ($1, $2, $3, $4, NOW())',
      [parentId, tenantA.tenantId, 'Parent unit', 'workshop'],
    );

    await expect(
      client.query(
        'INSERT INTO org_units (id, tenant_id, parent_id, name, type, updated_at) VALUES ($1, $2, $3, $4, $5, NOW())',
        [randomUUID(), tenantB.tenantId, parentId, 'Forged child', 'workshop'],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('rejects a production producer membership from another tenant', async () => {
    const tenantA = await createTenantMembership(client, 'Tenant A');
    const tenantB = await createTenantMembership(client, 'Tenant B');

    await expect(
      client.query(
        'INSERT INTO productions (id, tenant_id, title, status, producer_membership_id, health_status, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
        [
          randomUUID(),
          tenantA.tenantId,
          'Forged production',
          'draft',
          tenantB.membershipId,
          'neutral',
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('rejects an employee assignment to an org unit from another tenant', async () => {
    const tenantA = await createTenantMembership(client, 'Tenant A');
    const tenantB = await createTenantMembership(client, 'Tenant B');
    const employeeProfileId = randomUUID();
    const orgUnitId = randomUUID();

    await client.query(
      'INSERT INTO employee_profiles (id, tenant_id, membership_id, title, updated_at) VALUES ($1, $2, $3, $4, NOW())',
      [employeeProfileId, tenantA.tenantId, tenantA.membershipId, 'Director'],
    );
    await client.query(
      'INSERT INTO org_units (id, tenant_id, name, type, updated_at) VALUES ($1, $2, $3, $4, NOW())',
      [orgUnitId, tenantB.tenantId, 'Foreign unit', 'workshop'],
    );

    await expect(
      client.query(
        'INSERT INTO employee_profile_org_units (tenant_id, employee_profile_id, org_unit_id) VALUES ($1, $2, $3)',
        [tenantA.tenantId, employeeProfileId, orgUnitId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

async function createTenantMembership(client: Client, name: string) {
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

  return { tenantId, membershipId };
}
