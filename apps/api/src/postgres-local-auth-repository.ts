import { randomUUID } from 'node:crypto';

import type { LocalAuthRepository } from '@europa/auth/local-session';
import type { Client } from 'pg';

type SqlClient = Pick<Client, 'query'>;

interface CredentialRow {
  passwordHash: string;
  membershipId: string | null;
  tenantId: string | null;
  userId: string | null;
  membershipStatus: 'ACTIVE' | 'INACTIVE' | null;
}

interface SessionRow {
  userId: string;
  membershipId: string;
  tenantId: string;
}

export class PostgresLocalAuthRepository implements LocalAuthRepository {
  public constructor(private readonly client: SqlClient) {}

  public async findCredentialByEmail(email: string) {
    const result = await this.client.query<CredentialRow>(
      `SELECT pc.password_hash AS "passwordHash",
              m.id AS "membershipId",
              m.tenant_id AS "tenantId",
              m.user_id AS "userId",
              m.status AS "membershipStatus"
       FROM users u
       JOIN password_credentials pc ON pc.user_id = u.id
       LEFT JOIN memberships m ON m.user_id = u.id
       WHERE LOWER(u.email) = LOWER($1)
       ORDER BY m.created_at ASC`,
      [email],
    );
    const first = result.rows[0];
    if (!first) return null;

    return {
      passwordHash: first.passwordHash,
      memberships: result.rows.flatMap((row) =>
        row.membershipId && row.tenantId && row.userId && row.membershipStatus
          ? [
              {
                id: row.membershipId,
                tenantId: row.tenantId,
                userId: row.userId,
                isActive: row.membershipStatus === 'ACTIVE',
              },
            ]
          : [],
      ),
    };
  }

  public async createSession(input: {
    membershipId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO auth_sessions (id, token_hash, membership_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), input.tokenHash, input.membershipId, input.expiresAt],
    );
  }

  public async findVerifiedSession(tokenHash: string) {
    const result = await this.client.query<SessionRow>(
      `SELECT m.user_id AS "userId", m.id AS "membershipId", m.tenant_id AS "tenantId"
       FROM auth_sessions s
       JOIN memberships m ON m.id = s.membership_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > CURRENT_TIMESTAMP
         AND m.status = 'ACTIVE'
       LIMIT 1`,
      [tokenHash],
    );
    const session = result.rows[0];
    if (!session) return null;

    return {
      userId: session.userId,
      membership: {
        id: session.membershipId,
        tenantId: session.tenantId,
        userId: session.userId,
        isActive: true,
      },
    };
  }
}
