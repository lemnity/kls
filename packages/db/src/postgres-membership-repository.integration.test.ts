import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  MembershipAlreadyExistsError,
  MembershipRoleNotFoundError,
  MembershipUserNotFoundError,
  PostgresMembershipRepository,
} from './postgres-membership-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('PostgresMembershipRepository', () => {
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

  it('creates a membership and its audit event atomically within the tenant', async () => {
    const tenant = await createTenantAdmin(client, 'Tenant A');
    const newUserId = await createUser(client, 'new-member');
    const repository = new PostgresMembershipRepository(client);

    const membership = await repository.createMembership(tenant.context, {
      userId: newUserId,
      roleId: tenant.roleId,
    });

    expect(membership).toMatchObject({ userId: newUserId, roleId: tenant.roleId, status: 'ACTIVE' });
    await expect(
      client.query(
        "SELECT tenant_id, actor_membership_id, action, subject_type, subject_id FROM audit_events WHERE action = 'membership.created' AND subject_id = $1",
        [membership.id],
      ),
    ).resolves.toMatchObject({
      rows: [{
        tenant_id: tenant.context.tenantId,
        actor_membership_id: tenant.context.membershipId,
        action: 'membership.created',
        subject_type: 'membership',
        subject_id: membership.id,
      }],
    });
  });

  it('creates a membership without a role', async () => {
    const tenant = await createTenantAdmin(client, 'Tenant A');
    const newUserId = await createUser(client, 'no-role-member');
    const repository = new PostgresMembershipRepository(client);

    const membership = await repository.createMembership(tenant.context, { userId: newUserId });

    expect(membership).toMatchObject({ userId: newUserId, roleId: null, status: 'ACTIVE' });
  });

  it('rejects creating a membership for a nonexistent user', async () => {
    const tenant = await createTenantAdmin(client, 'Tenant A');
    const repository = new PostgresMembershipRepository(client);

    await expect(
      repository.createMembership(tenant.context, { userId: randomUUID() }),
    ).rejects.toBeInstanceOf(MembershipUserNotFoundError);
  });

  it('rejects creating a membership with a role from another tenant', async () => {
    const tenantA = await createTenantAdmin(client, 'Tenant A');
    const tenantB = await createTenantAdmin(client, 'Tenant B');
    const newUserId = await createUser(client, 'cross-tenant-role');
    const repository = new PostgresMembershipRepository(client);

    await expect(
      repository.createMembership(tenantA.context, { userId: newUserId, roleId: tenantB.roleId }),
    ).rejects.toBeInstanceOf(MembershipRoleNotFoundError);
  });

  it('rejects creating a duplicate membership for the same tenant', async () => {
    const tenant = await createTenantAdmin(client, 'Tenant A');
    const repository = new PostgresMembershipRepository(client);

    await expect(
      repository.createMembership(tenant.context, { userId: tenant.context.userId }),
    ).rejects.toBeInstanceOf(MembershipAlreadyExistsError);
  });

  it('deactivates an active membership and records one audit event', async () => {
    const tenant = await createTenantAdmin(client, 'Tenant A');
    const newUserId = await createUser(client, 'to-deactivate');
    const repository = new PostgresMembershipRepository(client);
    const membership = await repository.createMembership(tenant.context, { userId: newUserId });

    const deactivated = await repository.deactivateMembership(tenant.context, membership.id);

    expect(deactivated).toMatchObject({ id: membership.id, status: 'INACTIVE' });
    await expect(
      client.query("SELECT count(*)::int AS count FROM audit_events WHERE action = 'membership.deactivated' AND subject_id = $1", [membership.id]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('does not deactivate a membership from another tenant', async () => {
    const tenantA = await createTenantAdmin(client, 'Tenant A');
    const tenantB = await createTenantAdmin(client, 'Tenant B');
    const repository = new PostgresMembershipRepository(client);

    const result = await repository.deactivateMembership(tenantA.context, tenantB.membershipId);

    expect(result).toBeNull();
    await expect(
      client.query('SELECT status FROM memberships WHERE id = $1', [tenantB.membershipId]),
    ).resolves.toMatchObject({ rows: [{ status: 'ACTIVE' }] });
  });

  it('returns null when deactivating an already inactive membership', async () => {
    const tenant = await createTenantAdmin(client, 'Tenant A');
    const newUserId = await createUser(client, 'twice-deactivated');
    const repository = new PostgresMembershipRepository(client);
    const membership = await repository.createMembership(tenant.context, { userId: newUserId });
    await repository.deactivateMembership(tenant.context, membership.id);

    await expect(repository.deactivateMembership(tenant.context, membership.id)).resolves.toBeNull();
  });

  it('lists memberships scoped to the tenant with user email, ordered by email', async () => {
    const tenantA = await createTenantAdmin(client, 'Tenant A');
    const tenantB = await createTenantAdmin(client, 'Tenant B');
    const repository = new PostgresMembershipRepository(client);
    const bUserId = await createUser(client, 'aaa-first');
    await repository.createMembership(tenantB.context, { userId: bUserId });

    const listA = await repository.listMemberships(tenantA.context);

    expect(listA).toHaveLength(1);
    expect(listA[0]).toMatchObject({ id: tenantA.membershipId, userId: tenantA.context.userId, status: 'ACTIVE' });
    expect(listA[0]!.userEmail).toContain('@example.test');
  });
});

async function createUser(client: Client, label: string): Promise<string> {
  const userId = randomUUID();
  await client.query(
    'INSERT INTO users (id, email, "displayName", updated_at) VALUES ($1, $2, $3, NOW())',
    [userId, `${label}-${userId}@example.test`, label],
  );
  return userId;
}

async function createTenantAdmin(client: Client, name: string) {
  const tenantId = randomUUID();
  const userId = await createUser(client, `${name}-admin`);
  const roleId = randomUUID();
  const membershipId = randomUUID();
  await client.query('INSERT INTO tenants (id, name, updated_at) VALUES ($1, $2, NOW())', [tenantId, name]);
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
    roleId,
    membershipId,
    context: { requestId: randomUUID(), userId, membershipId, tenantId },
  };
}
