import { randomUUID } from 'node:crypto';

import { multiplyQuantityByUnitPrice, sumMoney } from '@kulisa/domain/money';
import type { TenantContext } from '@kulisa/domain/tenant-context';
import type { Client } from 'pg';

type SqlClient = Pick<Client, 'query'>;

export interface BudgetItemInput {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

export interface BudgetSectionInput {
  workshopId: string;
  title: string;
  items: BudgetItemInput[];
}

export interface CreateBudgetInput {
  productionId: string;
  sections: BudgetSectionInput[];
}

export interface StoredBudgetItem {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  total: string;
}

export interface StoredBudgetSection {
  id: string;
  workshopId: string;
  title: string;
  items: StoredBudgetItem[];
  subtotal: string;
}

export type BudgetStatus = 'PRELIMINARY' | 'DETAILED' | 'APPROVED';

export interface StoredBudget {
  id: string;
  productionId: string;
  status: BudgetStatus;
  versionId: string;
  revision: number;
  sections: StoredBudgetSection[];
  total: string;
}

export class BudgetProductionNotFoundError extends Error {
  public constructor(public readonly productionId: string) {
    super(`Production ${productionId} not found in tenant`);
    this.name = 'BudgetProductionNotFoundError';
  }
}

export class BudgetAlreadyExistsError extends Error {
  public constructor(public readonly productionId: string) {
    super(`Production ${productionId} already has a budget`);
    this.name = 'BudgetAlreadyExistsError';
  }
}

export class BudgetSectionWorkshopNotFoundError extends Error {
  public constructor(public readonly workshopId: string) {
    super(`Workshop ${workshopId} not found in tenant`);
    this.name = 'BudgetSectionWorkshopNotFoundError';
  }
}

export class BudgetAlreadyApprovedError extends Error {
  public constructor(public readonly budgetId: string) {
    super(`Budget ${budgetId} is already approved`);
    this.name = 'BudgetAlreadyApprovedError';
  }
}

interface BudgetRow {
  budgetId: string;
  productionId: string;
  status: BudgetStatus;
  versionId: string;
  revision: number;
  sectionId: string | null;
  workshopId: string | null;
  sectionTitle: string | null;
  itemId: string | null;
  description: string | null;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  total: string | null;
}

export class PostgresBudgetRepository {
  public constructor(private readonly client: SqlClient) {}

  public async createBudget(context: TenantContext, input: CreateBudgetInput): Promise<StoredBudget> {
    const requestedWorkshopIds = [...new Set(input.sections.map((section) => section.workshopId))];

    const precondition = await this.client.query<{
      productionExists: boolean;
      budgetAlreadyExists: boolean;
    }>(
      `SELECT
         EXISTS (SELECT 1 FROM productions WHERE id = $1 AND tenant_id = $2) AS "productionExists",
         EXISTS (SELECT 1 FROM budgets WHERE tenant_id = $2 AND production_id = $1) AS "budgetAlreadyExists"`,
      [input.productionId, context.tenantId],
    );
    const check = precondition.rows[0]!;
    if (!check.productionExists) throw new BudgetProductionNotFoundError(input.productionId);
    if (check.budgetAlreadyExists) throw new BudgetAlreadyExistsError(input.productionId);

    if (requestedWorkshopIds.length > 0) {
      const workshopCheck = await this.client.query<{ id: string }>(
        'SELECT id FROM workshops WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [context.tenantId, requestedWorkshopIds],
      );
      const foundIds = new Set(workshopCheck.rows.map((row) => row.id));
      const missing = requestedWorkshopIds.find((id) => !foundIds.has(id));
      if (missing) throw new BudgetSectionWorkshopNotFoundError(missing);
    }

    const budgetId = randomUUID();
    const versionId = randomUUID();
    const sectionsPayload = input.sections.map((section, sectionIndex) => ({
      id: randomUUID(),
      workshopId: section.workshopId,
      title: section.title,
      position: sectionIndex,
      items: section.items.map((item, itemIndex) => ({
        id: randomUUID(),
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        total: multiplyQuantityByUnitPrice(item.quantity, item.unitPrice),
        position: itemIndex,
      })),
    }));

    await this.client.query(
      `WITH input AS (
         SELECT $1::jsonb AS sections
       ), budget_ins AS (
         INSERT INTO budgets (id, tenant_id, production_id, status, updated_at)
         VALUES ($2, $3, $4, 'PRELIMINARY', NOW())
         RETURNING id
       ), version_ins AS (
         INSERT INTO budget_versions (id, tenant_id, budget_id, revision, created_by_membership_id)
         SELECT $5, $3, id, 1, $6 FROM budget_ins
         RETURNING id
       ), sections_ins AS (
         INSERT INTO budget_sections (id, tenant_id, budget_version_id, workshop_id, title, position)
         SELECT (s->>'id')::uuid, $3, v.id, (s->>'workshopId')::uuid, s->>'title', (s->>'position')::int
         FROM version_ins v, input, jsonb_array_elements(input.sections) AS s
         RETURNING id
       ), items_ins AS (
         INSERT INTO budget_items (id, tenant_id, budget_section_id, description, quantity, unit, unit_price, total, position)
         SELECT (i->>'id')::uuid, $3, (s->>'id')::uuid, i->>'description', (i->>'quantity')::numeric,
                i->>'unit', (i->>'unitPrice')::numeric, (i->>'total')::numeric, (i->>'position')::int
         FROM input, jsonb_array_elements(input.sections) AS s, jsonb_array_elements(s->'items') AS i
         RETURNING id
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $7, $3, $6, 'budget.created', 'budget', id, jsonb_build_object('productionId', $4)
         FROM budget_ins
       )
       SELECT id FROM budget_ins`,
      [
        JSON.stringify(sectionsPayload),
        budgetId,
        context.tenantId,
        input.productionId,
        versionId,
        context.membershipId,
        randomUUID(),
      ],
    );

    const budget = await this.getBudget(context, budgetId);
    return budget!;
  }

  public async getBudget(context: TenantContext, budgetId: string): Promise<StoredBudget | null> {
    return this.queryBudget('b.id = $1 AND b.tenant_id = $2', [budgetId, context.tenantId]);
  }

  public async approveBudget(context: TenantContext, budgetId: string): Promise<StoredBudget | null> {
    const existing = await this.client.query<{ status: BudgetStatus }>(
      'SELECT status FROM budgets WHERE id = $1 AND tenant_id = $2',
      [budgetId, context.tenantId],
    );
    const current = existing.rows[0];
    if (!current) return null;
    if (current.status === 'APPROVED') throw new BudgetAlreadyApprovedError(budgetId);

    await this.client.query(
      `WITH updated AS (
         UPDATE budgets
         SET status = 'APPROVED', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id
       )
       INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
       SELECT $3, $2, $4, 'budget.approved', 'budget', id, '{}'::jsonb
       FROM updated`,
      [budgetId, context.tenantId, randomUUID(), context.membershipId],
    );

    return this.getBudget(context, budgetId);
  }

  public async getBudgetByProductionId(context: TenantContext, productionId: string): Promise<StoredBudget | null> {
    return this.queryBudget('b.production_id = $1 AND b.tenant_id = $2', [productionId, context.tenantId]);
  }

  private async queryBudget(whereClause: string, params: unknown[]): Promise<StoredBudget | null> {
    const result = await this.client.query<BudgetRow>(
      `SELECT
         b.id AS "budgetId", b.production_id AS "productionId", b.status,
         v.id AS "versionId", v.revision,
         sec.id AS "sectionId", sec.workshop_id AS "workshopId", sec.title AS "sectionTitle",
         it.id AS "itemId", it.description, it.quantity, it.unit,
         it.unit_price AS "unitPrice", it.total
       FROM budgets b
       JOIN budget_versions v ON v.tenant_id = b.tenant_id AND v.budget_id = b.id
         AND v.revision = (SELECT MAX(revision) FROM budget_versions WHERE tenant_id = b.tenant_id AND budget_id = b.id)
       LEFT JOIN budget_sections sec ON sec.tenant_id = b.tenant_id AND sec.budget_version_id = v.id
       LEFT JOIN budget_items it ON it.tenant_id = b.tenant_id AND it.budget_section_id = sec.id
       WHERE ${whereClause}
       ORDER BY sec.position, it.position`,
      params,
    );

    const rows = result.rows;
    if (rows.length === 0) return null;

    const first = rows[0]!;
    const sections = new Map<string, StoredBudgetSection>();
    for (const row of rows) {
      if (!row.sectionId) continue;
      let section = sections.get(row.sectionId);
      if (!section) {
        section = {
          id: row.sectionId,
          workshopId: row.workshopId!,
          title: row.sectionTitle!,
          items: [],
          subtotal: '0.00',
        };
        sections.set(row.sectionId, section);
      }
      if (row.itemId) {
        section.items.push({
          id: row.itemId,
          description: row.description!,
          quantity: row.quantity!,
          unit: row.unit!,
          unitPrice: row.unitPrice!,
          total: row.total!,
        });
      }
    }

    for (const section of sections.values()) {
      section.subtotal = sumMoney(section.items.map((item) => item.total));
    }

    const allItemTotals = [...sections.values()].flatMap((section) => section.items.map((item) => item.total));

    return {
      id: first.budgetId,
      productionId: first.productionId,
      status: first.status,
      versionId: first.versionId,
      revision: first.revision,
      sections: [...sections.values()],
      total: sumMoney(allItemTotals),
    };
  }
}
