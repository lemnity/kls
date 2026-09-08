import { randomUUID } from 'node:crypto';

import type { TenantContext } from '@kulisa/domain/tenant-context';
import type { Client } from 'pg';

type SqlClient = Pick<Client, 'query'>;

export interface StoredWorkshop {
  id: string;
  name: string;
  isActive: boolean;
  managerMembershipId: string | null;
}

export class WorkshopNameAlreadyExistsError extends Error {
  public constructor(public readonly name: string) {
    super(`Workshop named "${name}" already exists in tenant`);
    this.name = 'WorkshopNameAlreadyExistsError';
  }
}

export class WorkshopManagerNotFoundError extends Error {
  public constructor(public readonly managerMembershipId: string) {
    super(`Membership ${managerMembershipId} not found in tenant`);
    this.name = 'WorkshopManagerNotFoundError';
  }
}

const WORKSHOP_RAW_COLUMNS = `id, name, is_active, manager_membership_id`;
const WORKSHOP_COLUMNS = `id, name, is_active AS "isActive", manager_membership_id AS "managerMembershipId"`;

export class PostgresWorkshopRepository {
  public constructor(private readonly client: SqlClient) {}

  public async createWorkshop(
    context: TenantContext,
    input: { name: string; managerMembershipId?: string },
  ): Promise<StoredWorkshop> {
    if (input.managerMembershipId && !(await this.membershipBelongsToTenant(context, input.managerMembershipId))) {
      throw new WorkshopManagerNotFoundError(input.managerMembershipId);
    }

    const result = await this.client.query<StoredWorkshop>(
      `WITH created AS (
         INSERT INTO workshops (id, tenant_id, name, manager_membership_id, updated_at)
         SELECT $1::uuid, $2::uuid, $3::varchar, $6::uuid, NOW()
         WHERE NOT EXISTS (SELECT 1 FROM workshops WHERE tenant_id = $2 AND name = $3)
         RETURNING ${WORKSHOP_RAW_COLUMNS}
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $4, $2, $5, 'workshop.created', 'workshop', id, jsonb_build_object('name', name)
         FROM created
       )
       SELECT ${WORKSHOP_COLUMNS} FROM created`,
      [randomUUID(), context.tenantId, input.name, randomUUID(), context.membershipId, input.managerMembershipId ?? null],
    );

    const workshop = result.rows[0];
    if (!workshop) throw new WorkshopNameAlreadyExistsError(input.name);
    return workshop;
  }

  public async assignWorkshopManager(
    context: TenantContext,
    workshopId: string,
    managerMembershipId: string | null,
  ): Promise<StoredWorkshop | null> {
    if (managerMembershipId && !(await this.membershipBelongsToTenant(context, managerMembershipId))) {
      throw new WorkshopManagerNotFoundError(managerMembershipId);
    }

    const result = await this.client.query<StoredWorkshop>(
      `WITH updated AS (
         UPDATE workshops
         SET manager_membership_id = $3::uuid, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING ${WORKSHOP_RAW_COLUMNS}
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $4, $2, $5, 'workshop.manager_assigned', 'workshop', id,
           jsonb_build_object('managerMembershipId', $3::uuid)
         FROM updated
       )
       SELECT ${WORKSHOP_COLUMNS} FROM updated`,
      [workshopId, context.tenantId, managerMembershipId, randomUUID(), context.membershipId],
    );

    return result.rows[0] ?? null;
  }

  public async listWorkshops(context: TenantContext): Promise<StoredWorkshop[]> {
    const result = await this.client.query<StoredWorkshop>(
      `SELECT ${WORKSHOP_COLUMNS}
       FROM workshops
       WHERE tenant_id = $1
       ORDER BY name ASC, id ASC`,
      [context.tenantId],
    );

    return result.rows;
  }

  private async membershipBelongsToTenant(context: TenantContext, membershipId: string): Promise<boolean> {
    const result = await this.client.query(
      'SELECT 1 FROM memberships WHERE id = $1 AND tenant_id = $2',
      [membershipId, context.tenantId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
