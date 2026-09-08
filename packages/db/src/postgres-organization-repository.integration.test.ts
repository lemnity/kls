import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  OrgUnitCycleError,
  OrgUnitParentNotFoundError,
  PostgresOrganizationRepository,
} from './postgres-organization-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('PostgresOrganizationRepository', () => {
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

  it('creates an org unit and its audit event atomically within the tenant', async () => {
    const context = await createTenantMembership(client, 'Tenant A');
    const repository = new PostgresOrganizationRepository(client);

    const orgUnit = await repository.createOrgUnit(context, {
      name: 'Scenic workshop',
      type: 'workshop',
    });

    expect(orgUnit).toMatchObject({ name: 'Scenic workshop', type: 'workshop' });
    await expect(
      client.query(
        'SELECT tenant_id, name, type FROM org_units WHERE id = $1',
        [orgUnit.id],
      ),
    ).resolves.toMatchObject({
      rows: [{ tenant_id: context.tenantId, name: 'Scenic workshop', type: 'workshop' }],
    });
    await expect(
      client.query(
        "SELECT tenant_id, actor_membership_id, action, subject_type, subject_id FROM audit_events WHERE action = 'org_unit.created' AND subject_id = $1",
        [orgUnit.id],
      ),
    ).resolves.toMatchObject({
      rows: [{
        tenant_id: context.tenantId,
        actor_membership_id: context.membershipId,
        action: 'org_unit.created',
        subject_type: 'org_unit',
        subject_id: orgUnit.id,
      }],
    });
  });

  it('creates a child org unit when parentId belongs to the same tenant', async () => {
    const context = await createTenantMembership(client, 'Tenant A');
    const repository = new PostgresOrganizationRepository(client);

    const parent = await repository.createOrgUnit(context, {
      name: 'Production',
      type: 'department',
    });
    const child = await repository.createOrgUnit(context, {
      name: 'Scenic workshop',
      type: 'workshop',
      parentId: parent.id,
    });

    await expect(
      client.query('SELECT parent_id FROM org_units WHERE id = $1', [child.id]),
    ).resolves.toMatchObject({ rows: [{ parent_id: parent.id }] });
  });

  it('rejects creating an org unit whose parentId does not exist', async () => {
    const context = await createTenantMembership(client, 'Tenant A');
    const repository = new PostgresOrganizationRepository(client);
    const missingParentId = randomUUID();

    await expect(
      repository.createOrgUnit(context, {
        name: 'Scenic workshop',
        type: 'workshop',
        parentId: missingParentId,
      }),
    ).rejects.toBeInstanceOf(OrgUnitParentNotFoundError);

    await expect(
      client.query("SELECT count(*)::int AS count FROM org_units WHERE tenant_id = $1", [context.tenantId]),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      client.query("SELECT count(*)::int AS count FROM audit_events WHERE action = 'org_unit.created' AND tenant_id = $1", [context.tenantId]),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it('rejects creating an org unit whose parentId belongs to another tenant', async () => {
    const tenantA = await createTenantMembership(client, 'Tenant A');
    const tenantB = await createTenantMembership(client, 'Tenant B');
    const repository = new PostgresOrganizationRepository(client);
    const foreignParent = await repository.createOrgUnit(tenantB, {
      name: 'Foreign department',
      type: 'department',
    });

    await expect(
      repository.createOrgUnit(tenantA, {
        name: 'Forged child',
        type: 'workshop',
        parentId: foreignParent.id,
      }),
    ).rejects.toBeInstanceOf(OrgUnitParentNotFoundError);

    await expect(
      client.query("SELECT count(*)::int AS count FROM org_units WHERE tenant_id = $1", [tenantA.tenantId]),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it('moves an org unit to a new parent and records an audit event with old and new parent', async () => {
    const context = await createTenantMembership(client, 'Tenant A');
    const repository = new PostgresOrganizationRepository(client);

    const oldParent = await repository.createOrgUnit(context, { name: 'Production', type: 'department' });
    const newParent = await repository.createOrgUnit(context, { name: 'Costume department', type: 'department' });
    const child = await repository.createOrgUnit(context, {
      name: 'Scenic workshop',
      type: 'workshop',
      parentId: oldParent.id,
    });

    const moved = await repository.moveOrgUnit(context, child.id, newParent.id);

    expect(moved).toMatchObject({ id: child.id, name: 'Scenic workshop', type: 'workshop' });
    await expect(
      client.query('SELECT parent_id FROM org_units WHERE id = $1', [child.id]),
    ).resolves.toMatchObject({ rows: [{ parent_id: newParent.id }] });
    await expect(
      client.query(
        "SELECT changes FROM audit_events WHERE action = 'org_unit.moved' AND subject_id = $1",
        [child.id],
      ),
    ).resolves.toMatchObject({
      rows: [{ changes: { oldParentId: oldParent.id, newParentId: newParent.id } }],
    });
  });

  it('moves an org unit to the root when parentId is null', async () => {
    const context = await createTenantMembership(client, 'Tenant A');
    const repository = new PostgresOrganizationRepository(client);

    const parent = await repository.createOrgUnit(context, { name: 'Production', type: 'department' });
    const child = await repository.createOrgUnit(context, {
      name: 'Scenic workshop',
      type: 'workshop',
      parentId: parent.id,
    });

    await repository.moveOrgUnit(context, child.id, null);

    await expect(
      client.query('SELECT parent_id FROM org_units WHERE id = $1', [child.id]),
    ).resolves.toMatchObject({ rows: [{ parent_id: null }] });
  });

  it('returns null when moving an org unit not in the tenant', async () => {
    const tenantA = await createTenantMembership(client, 'Tenant A');
    const tenantB = await createTenantMembership(client, 'Tenant B');
    const repository = new PostgresOrganizationRepository(client);
    const foreignUnit = await repository.createOrgUnit(tenantB, { name: 'Foreign', type: 'department' });

    await expect(repository.moveOrgUnit(tenantA, foreignUnit.id, null)).resolves.toBeNull();
  });

  it('rejects moving an org unit under itself', async () => {
    const context = await createTenantMembership(client, 'Tenant A');
    const repository = new PostgresOrganizationRepository(client);
    const unit = await repository.createOrgUnit(context, { name: 'Production', type: 'department' });

    await expect(repository.moveOrgUnit(context, unit.id, unit.id)).rejects.toBeInstanceOf(OrgUnitCycleError);
  });

  it('rejects moving an org unit under its own descendant', async () => {
    const context = await createTenantMembership(client, 'Tenant A');
    const repository = new PostgresOrganizationRepository(client);
    const grandparent = await repository.createOrgUnit(context, { name: 'Production', type: 'department' });
    const parent = await repository.createOrgUnit(context, {
      name: 'Costume department',
      type: 'department',
      parentId: grandparent.id,
    });
    const child = await repository.createOrgUnit(context, {
      name: 'Scenic workshop',
      type: 'workshop',
      parentId: parent.id,
    });

    await expect(repository.moveOrgUnit(context, grandparent.id, child.id)).rejects.toBeInstanceOf(
      OrgUnitCycleError,
    );
    await expect(
      client.query('SELECT parent_id FROM org_units WHERE id = $1', [grandparent.id]),
    ).resolves.toMatchObject({ rows: [{ parent_id: null }] });
  });

  it('rejects moving an org unit under a parent from another tenant', async () => {
    const tenantA = await createTenantMembership(client, 'Tenant A');
    const tenantB = await createTenantMembership(client, 'Tenant B');
    const repository = new PostgresOrganizationRepository(client);
    const unit = await repository.createOrgUnit(tenantA, { name: 'Production', type: 'department' });
    const foreignParent = await repository.createOrgUnit(tenantB, { name: 'Foreign', type: 'department' });

    await expect(repository.moveOrgUnit(tenantA, unit.id, foreignParent.id)).rejects.toBeInstanceOf(
      OrgUnitParentNotFoundError,
    );
  });

  it('deactivates an org unit, records an audit event, and keeps it visible in the list', async () => {
    const context = await createTenantMembership(client, 'Tenant A');
    const repository = new PostgresOrganizationRepository(client);
    const unit = await repository.createOrgUnit(context, { name: 'Пошивочный цех', type: 'workshop' });

    const deactivated = await repository.deactivateOrgUnit(context, unit.id);

    expect(deactivated).toMatchObject({ id: unit.id, name: 'Пошивочный цех', type: 'workshop' });
    await expect(
      client.query('SELECT is_active FROM org_units WHERE id = $1', [unit.id]),
    ).resolves.toMatchObject({ rows: [{ is_active: false }] });
    await expect(
      client.query(
        "SELECT count(*)::int AS count FROM audit_events WHERE action = 'org_unit.deactivated' AND subject_id = $1",
        [unit.id],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });

    const list = await repository.listOrgUnits(context);
    expect(list).toContainEqual(expect.objectContaining({ id: unit.id, isActive: false }));
  });

  it('returns null when deactivating an already-inactive org unit, without a duplicate audit event', async () => {
    const context = await createTenantMembership(client, 'Tenant A');
    const repository = new PostgresOrganizationRepository(client);
    const unit = await repository.createOrgUnit(context, { name: 'Пошивочный цех', type: 'workshop' });
    await repository.deactivateOrgUnit(context, unit.id);

    await expect(repository.deactivateOrgUnit(context, unit.id)).resolves.toBeNull();
    await expect(
      client.query(
        "SELECT count(*)::int AS count FROM audit_events WHERE action = 'org_unit.deactivated' AND subject_id = $1",
        [unit.id],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('returns null when deactivating an org unit outside the tenant', async () => {
    const tenantA = await createTenantMembership(client, 'Tenant A');
    const tenantB = await createTenantMembership(client, 'Tenant B');
    const repository = new PostgresOrganizationRepository(client);
    const foreignUnit = await repository.createOrgUnit(tenantB, { name: 'Foreign', type: 'department' });

    await expect(repository.deactivateOrgUnit(tenantA, foreignUnit.id)).resolves.toBeNull();
  });

  it('lists org units scoped to the tenant, ordered by name', async () => {
    const tenantA = await createTenantMembership(client, 'Tenant A');
    const tenantB = await createTenantMembership(client, 'Tenant B');
    const repository = new PostgresOrganizationRepository(client);

    const parent = await repository.createOrgUnit(tenantA, { name: 'Production', type: 'department' });
    const child = await repository.createOrgUnit(tenantA, {
      name: 'Scenic workshop',
      type: 'workshop',
      parentId: parent.id,
    });
    await repository.createOrgUnit(tenantB, { name: 'Other tenant unit', type: 'department' });

    const list = await repository.listOrgUnits(tenantA);

    expect(list).toEqual([
      { id: parent.id, name: 'Production', type: 'department', parentId: null, isActive: true },
      { id: child.id, name: 'Scenic workshop', type: 'workshop', parentId: parent.id, isActive: true },
    ]);
  });

  it('returns an empty list for a tenant with no org units', async () => {
    const context = await createTenantMembership(client, 'Tenant A');
    const repository = new PostgresOrganizationRepository(client);

    await expect(repository.listOrgUnits(context)).resolves.toEqual([]);
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
    [userId, `${userId}@example.test`, 'Admin'],
  );
  await client.query(
    'INSERT INTO roles (id, tenant_id, name, updated_at) VALUES ($1, $2, $3, NOW())',
    [roleId, tenantId, 'theatre_admin'],
  );
  await client.query(
    'INSERT INTO memberships (id, tenant_id, user_id, role_id, updated_at) VALUES ($1, $2, $3, $4, NOW())',
    [membershipId, tenantId, userId, roleId],
  );
  return { requestId: randomUUID(), userId, membershipId, tenantId };
}
