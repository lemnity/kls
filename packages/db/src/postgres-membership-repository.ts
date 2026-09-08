import { randomUUID } from 'node:crypto';

import type { TenantContext } from '@kulisa/domain/tenant-context';
import type { Client } from 'pg';

type SqlClient = Pick<Client, 'query'>;

export interface StoredMembership {
  id: string;
  userId: string;
  roleId: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

export class MembershipUserNotFoundError extends Error {
  public constructor(public readonly userId: string) {
    super(`User ${userId} not found`);
    this.name = 'MembershipUserNotFoundError';
  }
}

export class MembershipRoleNotFoundError extends Error {
  public constructor(public readonly roleId: string) {
    super(`Role ${roleId} not found in tenant`);
    this.name = 'MembershipRoleNotFoundError';
  }
}

export class MembershipAlreadyExistsError extends Error {
  public constructor(public readonly userId: string) {
    super(`User ${userId} already has a membership in this tenant`);
    this.name = 'MembershipAlreadyExistsError';
  }
}

export class PostgresMembershipRepository {
  public constructor(private readonly client: SqlClient) {}

  public async createMembership(
    context: TenantContext,
    input: { userId: string; roleId?: string },
  ): Promise<StoredMembership> {
    const precondition = await this.client.query<{
      userExists: boolean;
      roleOk: boolean;
      notAlreadyMember: boolean;
    }>(
      `SELECT
         EXISTS (SELECT 1 FROM users WHERE id = $1) AS "userExists",
         ($2::uuid IS NULL OR EXISTS (
           SELECT 1 FROM roles WHERE id = $2::uuid AND tenant_id = $3
         )) AS "roleOk",
         NOT EXISTS (
           SELECT 1 FROM memberships WHERE tenant_id = $3 AND user_id = $1
         ) AS "notAlreadyMember"`,
      [input.userId, input.roleId ?? null, context.tenantId],
    );
    const check = precondition.rows[0]!;
    if (!check.userExists) throw new MembershipUserNotFoundError(input.userId);
    if (!check.roleOk) throw new MembershipRoleNotFoundError(input.roleId!);
    if (!check.notAlreadyMember) throw new MembershipAlreadyExistsError(input.userId);

    const result = await this.client.query<StoredMembership>(
      `WITH created AS (
         INSERT INTO memberships (
           id, tenant_id, user_id, role_id, status, updated_at
         )
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW())
         RETURNING id, user_id AS "userId", role_id AS "roleId", status
       ), audited AS (
         INSERT INTO audit_events (
           id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes
         )
         SELECT $5, $2, $6, 'membership.created', 'membership', id,
           jsonb_build_object('userId', "userId", 'roleId', "roleId")
         FROM created
       )
       SELECT id, "userId", "roleId", status FROM created`,
      [
        randomUUID(),
        context.tenantId,
        input.userId,
        input.roleId ?? null,
        randomUUID(),
        context.membershipId,
      ],
    );

    return result.rows[0]!;
  }

  public async deactivateMembership(
    context: TenantContext,
    membershipId: string,
  ): Promise<StoredMembership | null> {
    const result = await this.client.query<StoredMembership>(
      `WITH updated AS (
         UPDATE memberships
         SET status = 'INACTIVE', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND status = 'ACTIVE'
         RETURNING id, user_id AS "userId", role_id AS "roleId", status
       ), audited AS (
         INSERT INTO audit_events (
           id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes
         )
         SELECT $3, $2, $4, 'membership.deactivated', 'membership', id, '{}'::jsonb
         FROM updated
       )
       SELECT id, "userId", "roleId", status FROM updated`,
      [membershipId, context.tenantId, randomUUID(), context.membershipId],
    );

    return result.rows[0] ?? null;
  }
}
