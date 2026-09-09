import { randomUUID } from 'node:crypto';

import type { TenantContext } from '@kulisa/domain/tenant-context';
import type { Client } from 'pg';

type SqlClient = Pick<Client, 'query'>;

export type BudgetTemplateNodeType = 'production' | 'workshop' | 'work' | 'material';

export interface StoredBudgetTemplate {
  id: string;
  name: string;
  nodeType: BudgetTemplateNodeType;
  plannedAmount: string;
}

export interface CreateBudgetTemplateInput {
  name: string;
  nodeType: BudgetTemplateNodeType;
  plannedAmount: string;
}

const TEMPLATE_COLUMNS = `id, name, node_type AS "nodeType", planned_amount AS "plannedAmount"`;

export class PostgresBudgetTemplateRepository {
  public constructor(private readonly client: SqlClient) {}

  public async createTemplate(
    context: TenantContext,
    input: CreateBudgetTemplateInput,
  ): Promise<StoredBudgetTemplate> {
    const result = await this.client.query<StoredBudgetTemplate>(
      `WITH created AS (
         INSERT INTO budget_templates (id, tenant_id, name, node_type, planned_amount)
         VALUES ($1, $2, $3, $4, $5::numeric)
         RETURNING id, name, node_type, planned_amount
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $6, $2, $7, 'budget_template.created', 'budget_template', id,
           jsonb_build_object('name', $3, 'nodeType', $4)
         FROM created
       )
       SELECT ${TEMPLATE_COLUMNS} FROM created`,
      [randomUUID(), context.tenantId, input.name, input.nodeType, input.plannedAmount, randomUUID(), context.membershipId],
    );

    return result.rows[0]!;
  }

  public async listTemplates(context: TenantContext): Promise<StoredBudgetTemplate[]> {
    const result = await this.client.query<StoredBudgetTemplate>(
      `SELECT ${TEMPLATE_COLUMNS} FROM budget_templates
       WHERE tenant_id = $1
       ORDER BY created_at ASC, id ASC`,
      [context.tenantId],
    );

    return result.rows;
  }

  public async deleteTemplate(context: TenantContext, templateId: string): Promise<boolean> {
    const result = await this.client.query(
      `WITH deleted AS (
         DELETE FROM budget_templates WHERE id = $1 AND tenant_id = $2
         RETURNING id
       )
       INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
       SELECT $3, $2, $4, 'budget_template.deleted', 'budget_template', id, '{}'::jsonb
       FROM deleted
       RETURNING id`,
      [templateId, context.tenantId, randomUUID(), context.membershipId],
    );

    return (result.rowCount ?? 0) > 0;
  }
}
