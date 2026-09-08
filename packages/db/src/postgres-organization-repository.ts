import { randomUUID } from 'node:crypto';

import type { TenantContext } from '@kulisa/domain/tenant-context';
import type { Client } from 'pg';

type SqlClient = Pick<Client, 'query'>;

export interface StoredOrgUnit {
  id: string;
  name: string;
  type: string;
}

export interface OrgUnitListItem {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  isActive: boolean;
}

export class OrgUnitParentNotFoundError extends Error {
  public constructor(public readonly parentId: string) {
    super(`Org unit parent ${parentId} not found in tenant`);
    this.name = 'OrgUnitParentNotFoundError';
  }
}

export class OrgUnitCycleError extends Error {
  public constructor(
    public readonly orgUnitId: string,
    public readonly newParentId: string,
  ) {
    super(`Moving org unit ${orgUnitId} under ${newParentId} would create a cycle`);
    this.name = 'OrgUnitCycleError';
  }
}

export class PostgresOrganizationRepository {
  public constructor(private readonly client: SqlClient) {}

  public async createOrgUnit(
    context: TenantContext,
    input: {
      name: string;
      type: string;
      parentId?: string;
      managerMembershipId?: string;
    },
  ): Promise<StoredOrgUnit> {
    const result = await this.client.query<StoredOrgUnit>(
      `WITH created AS (
         INSERT INTO org_units (
           id, tenant_id, parent_id, manager_membership_id, name, type, updated_at
         )
         SELECT $1, $2, $3::uuid, $4, $5, $6, NOW()
         WHERE $3::uuid IS NULL OR EXISTS (
           SELECT 1 FROM org_units p WHERE p.id = $3::uuid AND p.tenant_id = $2
         )
         RETURNING id, name, type
       ), audited AS (
         INSERT INTO audit_events (
           id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes
         )
         SELECT $7, $2, $8, 'org_unit.created', 'org_unit', id,
           jsonb_build_object('name', name, 'type', type)
         FROM created
       )
       SELECT id, name, type FROM created`,
      [
        randomUUID(),
        context.tenantId,
        input.parentId ?? null,
        input.managerMembershipId ?? null,
        input.name,
        input.type,
        randomUUID(),
        context.membershipId,
      ],
    );

    const orgUnit = result.rows[0];
    if (!orgUnit) {
      // input.parentId must be set here: when it is undefined the WHERE clause
      // ($3::uuid IS NULL) is always true, so zero rows only happens when a
      // given parentId failed the same-tenant EXISTS check above.
      throw new OrgUnitParentNotFoundError(input.parentId!);
    }
    return orgUnit;
  }

  public async moveOrgUnit(
    context: TenantContext,
    orgUnitId: string,
    newParentId: string | null,
  ): Promise<StoredOrgUnit | null> {
    const existing = await this.client.query<{ parentId: string | null }>(
      'SELECT parent_id AS "parentId" FROM org_units WHERE id = $1 AND tenant_id = $2',
      [orgUnitId, context.tenantId],
    );
    const current = existing.rows[0];
    if (!current) return null;

    if (newParentId !== null) {
      if (newParentId === orgUnitId) throw new OrgUnitCycleError(orgUnitId, newParentId);

      const check = await this.client.query<{ parentExists: boolean; isDescendant: boolean }>(
        `WITH RECURSIVE ancestors AS (
           SELECT id, parent_id FROM org_units WHERE id = $1 AND tenant_id = $2
           UNION ALL
           SELECT o.id, o.parent_id FROM org_units o
           JOIN ancestors a ON o.id = a.parent_id
           WHERE o.tenant_id = $2
         )
         SELECT
           EXISTS (SELECT 1 FROM org_units WHERE id = $1 AND tenant_id = $2) AS "parentExists",
           EXISTS (SELECT 1 FROM ancestors WHERE id = $3) AS "isDescendant"`,
        [newParentId, context.tenantId, orgUnitId],
      );
      const result = check.rows[0]!;
      if (!result.parentExists) throw new OrgUnitParentNotFoundError(newParentId);
      if (result.isDescendant) throw new OrgUnitCycleError(orgUnitId, newParentId);
    }

    const updated = await this.client.query<StoredOrgUnit>(
      `WITH updated AS (
         UPDATE org_units
         SET parent_id = $3::uuid, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, name, type
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $4, $2, $5, 'org_unit.moved', 'org_unit', id,
           jsonb_build_object('oldParentId', $6::uuid, 'newParentId', $3::uuid)
         FROM updated
       )
       SELECT id, name, type FROM updated`,
      [orgUnitId, context.tenantId, newParentId, randomUUID(), context.membershipId, current.parentId],
    );

    return updated.rows[0]!;
  }

  public async deactivateOrgUnit(context: TenantContext, orgUnitId: string): Promise<StoredOrgUnit | null> {
    const result = await this.client.query<StoredOrgUnit>(
      `WITH updated AS (
         UPDATE org_units
         SET is_active = false, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND is_active = true
         RETURNING id, name, type
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $3, $2, $4, 'org_unit.deactivated', 'org_unit', id, '{}'::jsonb
         FROM updated
       )
       SELECT id, name, type FROM updated`,
      [orgUnitId, context.tenantId, randomUUID(), context.membershipId],
    );

    return result.rows[0] ?? null;
  }

  public async listOrgUnits(context: TenantContext): Promise<OrgUnitListItem[]> {
    const result = await this.client.query<OrgUnitListItem>(
      `SELECT id, name, type, parent_id AS "parentId", is_active AS "isActive"
       FROM org_units
       WHERE tenant_id = $1
       ORDER BY name ASC, id ASC`,
      [context.tenantId],
    );

    return result.rows;
  }
}
