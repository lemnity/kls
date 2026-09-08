import { randomUUID } from 'node:crypto';

import type { TenantContext } from '@kulisa/domain/tenant-context';
import type { Client } from 'pg';

type SqlClient = Pick<Client, 'query'>;

export interface StoredWorkshop {
  id: string;
  name: string;
  isActive: boolean;
}

export class WorkshopNameAlreadyExistsError extends Error {
  public constructor(public readonly name: string) {
    super(`Workshop named "${name}" already exists in tenant`);
    this.name = 'WorkshopNameAlreadyExistsError';
  }
}

export class PostgresWorkshopRepository {
  public constructor(private readonly client: SqlClient) {}

  public async createWorkshop(context: TenantContext, input: { name: string }): Promise<StoredWorkshop> {
    const result = await this.client.query<StoredWorkshop>(
      `WITH created AS (
         INSERT INTO workshops (id, tenant_id, name, updated_at)
         SELECT $1::uuid, $2::uuid, $3::varchar, NOW()
         WHERE NOT EXISTS (SELECT 1 FROM workshops WHERE tenant_id = $2 AND name = $3)
         RETURNING id, name, is_active AS "isActive"
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $4, $2, $5, 'workshop.created', 'workshop', id, jsonb_build_object('name', name)
         FROM created
       )
       SELECT id, name, "isActive" FROM created`,
      [randomUUID(), context.tenantId, input.name, randomUUID(), context.membershipId],
    );

    const workshop = result.rows[0];
    if (!workshop) throw new WorkshopNameAlreadyExistsError(input.name);
    return workshop;
  }

  public async listWorkshops(context: TenantContext): Promise<StoredWorkshop[]> {
    const result = await this.client.query<StoredWorkshop>(
      `SELECT id, name, is_active AS "isActive"
       FROM workshops
       WHERE tenant_id = $1
       ORDER BY name ASC, id ASC`,
      [context.tenantId],
    );

    return result.rows;
  }
}
