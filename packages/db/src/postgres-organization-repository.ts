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
