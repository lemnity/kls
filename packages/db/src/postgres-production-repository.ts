import { randomUUID } from 'node:crypto';

import type { TenantContext } from '@kulisa/domain/tenant-context';
import type { Client } from 'pg';

type SqlClient = Pick<Client, 'query'>;

export interface StoredProduction {
  id: string;
  title: string;
  status: string;
  premiereDate: string | null;
  producerMembershipId: string | null;
  healthStatus: string;
  healthReason: string | null;
}

export interface ProductionInput {
  title: string;
  status: string;
  premiereDate: string | null;
  producerMembershipId: string | null;
}

const NEUTRAL_HEALTH_STATUS = 'neutral';

const PRODUCTION_COLUMNS = `id, title, status, to_char(premiere_date, 'YYYY-MM-DD') AS "premiereDate",
           producer_membership_id AS "producerMembershipId", health_status AS "healthStatus",
           health_reason AS "healthReason"`;

export class ProductionProducerNotFoundError extends Error {
  public constructor(public readonly producerMembershipId: string) {
    super(`Producer membership ${producerMembershipId} not found in tenant`);
    this.name = 'ProductionProducerNotFoundError';
  }
}

export class PostgresProductionRepository {
  public constructor(private readonly client: SqlClient) {}

  public async createProduction(
    context: TenantContext,
    input: ProductionInput,
  ): Promise<StoredProduction> {
    if (input.producerMembershipId && !(await this.producerBelongsToTenant(context, input.producerMembershipId))) {
      throw new ProductionProducerNotFoundError(input.producerMembershipId);
    }

    const result = await this.client.query<StoredProduction>(
      `WITH created AS (
         INSERT INTO productions (
           id, tenant_id, title, status, premiere_date, producer_membership_id, health_status, updated_at
         )
         VALUES ($1, $2, $3, $4, $5::date, $6, $7, NOW())
         RETURNING id, title, status, premiere_date, producer_membership_id, health_status, health_reason
       ), audited AS (
         INSERT INTO audit_events (
           id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes
         )
         SELECT $8, $2, $9, 'production.created', 'production', id,
           jsonb_build_object('title', title, 'status', status)
         FROM created
       )
       SELECT ${PRODUCTION_COLUMNS} FROM created`,
      [
        randomUUID(),
        context.tenantId,
        input.title,
        input.status,
        input.premiereDate,
        input.producerMembershipId,
        NEUTRAL_HEALTH_STATUS,
        randomUUID(),
        context.membershipId,
      ],
    );

    return result.rows[0]!;
  }

  public async getProduction(context: TenantContext, productionId: string): Promise<StoredProduction | null> {
    const result = await this.client.query<StoredProduction>(
      `SELECT ${PRODUCTION_COLUMNS}
       FROM productions
       WHERE id = $1 AND tenant_id = $2`,
      [productionId, context.tenantId],
    );

    return result.rows[0] ?? null;
  }

  public async listProductions(context: TenantContext): Promise<StoredProduction[]> {
    const result = await this.client.query<StoredProduction>(
      `SELECT ${PRODUCTION_COLUMNS}
       FROM productions
       WHERE tenant_id = $1
       ORDER BY title ASC, id ASC`,
      [context.tenantId],
    );

    return result.rows;
  }

  public async updateProduction(
    context: TenantContext,
    productionId: string,
    input: ProductionInput,
  ): Promise<StoredProduction | null> {
    const existing = await this.client.query(
      'SELECT 1 FROM productions WHERE id = $1 AND tenant_id = $2',
      [productionId, context.tenantId],
    );
    if (existing.rowCount === 0) return null;

    if (input.producerMembershipId && !(await this.producerBelongsToTenant(context, input.producerMembershipId))) {
      throw new ProductionProducerNotFoundError(input.producerMembershipId);
    }

    const result = await this.client.query<StoredProduction>(
      `WITH updated AS (
         UPDATE productions
         SET title = $3, status = $4, premiere_date = $5::date, producer_membership_id = $6, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, title, status, premiere_date, producer_membership_id, health_status, health_reason
       ), audited AS (
         INSERT INTO audit_events (
           id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes
         )
         SELECT $7, $2, $8, 'production.updated', 'production', id,
           jsonb_build_object('title', title, 'status', status)
         FROM updated
       )
       SELECT ${PRODUCTION_COLUMNS} FROM updated`,
      [
        productionId,
        context.tenantId,
        input.title,
        input.status,
        input.premiereDate,
        input.producerMembershipId,
        randomUUID(),
        context.membershipId,
      ],
    );

    return result.rows[0] ?? null;
  }

  private async producerBelongsToTenant(context: TenantContext, membershipId: string): Promise<boolean> {
    const result = await this.client.query(
      'SELECT 1 FROM memberships WHERE id = $1 AND tenant_id = $2',
      [membershipId, context.tenantId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
