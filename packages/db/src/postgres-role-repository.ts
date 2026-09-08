import { randomUUID } from 'node:crypto';

import type { TenantContext } from '@kulisa/domain/tenant-context';
import type { Client } from 'pg';

type SqlClient = Pick<Client, 'query'>;

export interface StoredRole {
  id: string;
  name: string;
}

export class PostgresRoleRepository {
  public constructor(private readonly client: SqlClient) {}

  public async findById(
    context: TenantContext,
    roleId: string,
  ): Promise<StoredRole | null> {
    const result = await this.client.query<StoredRole>(
      'SELECT id, name FROM roles WHERE id = $1 AND tenant_id = $2',
      [roleId, context.tenantId],
    );

    return result.rows[0] ?? null;
  }

  public async rename(
    context: TenantContext,
    roleId: string,
    name: string,
  ): Promise<StoredRole | null> {
    const result = await this.client.query<StoredRole>(
      `WITH updated AS (
         UPDATE roles
         SET name = $3, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, name
       ), audited AS (
         INSERT INTO audit_events (
           id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes
         )
         SELECT $4, $2, $5, 'role.renamed', 'role', id, jsonb_build_object('name', name)
         FROM updated
       )
       SELECT id, name FROM updated`,
      [roleId, context.tenantId, name, randomUUID(), context.membershipId],
    );

    return result.rows[0] ?? null;
  }
}
