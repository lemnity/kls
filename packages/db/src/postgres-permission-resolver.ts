import type { PermissionResolver } from '@europa/domain/permission-authorizer';
import type { TenantContext } from '@europa/domain/tenant-context';
import type { Client } from 'pg';

type SqlClient = Pick<Client, 'query'>;

export class PostgresPermissionResolver implements PermissionResolver {
  public constructor(private readonly client: SqlClient) {}

  public async hasPermission(
    context: TenantContext,
    permission: string,
  ): Promise<boolean> {
    const result = await this.client.query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM memberships m
         JOIN role_permissions rp ON rp.role_id = m.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE m.id = $1
           AND m.tenant_id = $2
           AND m.user_id = $3
           AND m.status = 'ACTIVE'
           AND p.code = $4
       ) AS allowed`,
      [context.membershipId, context.tenantId, context.userId, permission],
    );

    return result.rows[0]?.allowed === true;
  }
}
