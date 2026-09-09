import { randomUUID } from 'node:crypto';

import { sumMoney } from '@kulisa/domain/money';
import type { TenantContext } from '@kulisa/domain/tenant-context';
import type { Client } from 'pg';

type SqlClient = Pick<Client, 'query'>;

export type BudgetGraphNodeType = 'production' | 'workshop' | 'work' | 'material';

const NODE_TYPE_PARENT: Record<BudgetGraphNodeType, BudgetGraphNodeType | null> = {
  production: null,
  workshop: 'production',
  work: 'workshop',
  material: 'work',
};

export interface StoredBudgetGraphNode {
  id: string;
  budgetVersionId: string;
  parentId: string | null;
  workshopId: string | null;
  nodeType: BudgetGraphNodeType;
  title: string;
  plannedAmount: string;
  subtreeTotal: string;
  approvedTotal: string | null;
  positionX: string;
  positionY: string;
  width: string;
  height: string;
  revision: number;
}

export interface CreateBudgetGraphNodeInput {
  parentId?: string;
  workshopId?: string;
  nodeType: BudgetGraphNodeType;
  title: string;
  plannedAmount: string;
  positionX: string;
  positionY: string;
  width: string;
  height: string;
}

export class BudgetGraphVersionNotFoundError extends Error {
  public constructor(public readonly budgetVersionId: string) {
    super(`Budget version ${budgetVersionId} not found in tenant`);
    this.name = 'BudgetGraphVersionNotFoundError';
  }
}

export class BudgetGraphNodeNotFoundError extends Error {
  public constructor(public readonly nodeId: string) {
    super(`Budget graph node ${nodeId} not found in tenant`);
    this.name = 'BudgetGraphNodeNotFoundError';
  }
}

export class BudgetGraphWorkshopNotFoundError extends Error {
  public constructor(public readonly workshopId: string) {
    super(`Workshop ${workshopId} not found in tenant`);
    this.name = 'BudgetGraphWorkshopNotFoundError';
  }
}

export class BudgetGraphInvalidHierarchyError extends Error {
  public constructor(
    public readonly nodeType: BudgetGraphNodeType,
    public readonly parentNodeType: BudgetGraphNodeType | null,
  ) {
    super(`A '${nodeType}' node cannot have a parent of type '${parentNodeType ?? 'none'}'`);
    this.name = 'BudgetGraphInvalidHierarchyError';
  }
}

export class BudgetGraphCycleError extends Error {
  public constructor(
    public readonly nodeId: string,
    public readonly newParentId: string,
  ) {
    super(`Moving node ${nodeId} under ${newParentId} would create a cycle`);
    this.name = 'BudgetGraphCycleError';
  }
}

export class BudgetGraphRevisionConflictError extends Error {
  public constructor(
    public readonly nodeId: string,
    public readonly expectedRevision: number,
  ) {
    super(`Node ${nodeId} was not at expected revision ${expectedRevision}`);
    this.name = 'BudgetGraphRevisionConflictError';
  }
}

const NODE_RAW_COLUMNS = `id, budget_version_id, parent_id, workshop_id, node_type, title,
           planned_amount, position_x, position_y, width, height, revision`;
const NODE_COLUMNS = `id, budget_version_id AS "budgetVersionId", parent_id AS "parentId",
           workshop_id AS "workshopId", node_type AS "nodeType", title, planned_amount AS "plannedAmount",
           position_x AS "positionX", position_y AS "positionY", width, height, revision`;

interface NodeRow {
  id: string;
  budgetVersionId: string;
  parentId: string | null;
  workshopId: string | null;
  nodeType: BudgetGraphNodeType;
  title: string;
  plannedAmount: string;
  positionX: string;
  positionY: string;
  width: string;
  height: string;
  revision: number;
}

export class PostgresBudgetGraphRepository {
  public constructor(private readonly client: SqlClient) {}

  public async createNode(
    context: TenantContext,
    budgetVersionId: string,
    input: CreateBudgetGraphNodeInput,
  ): Promise<StoredBudgetGraphNode> {
    const versionExists = await this.client.query(
      'SELECT 1 FROM budget_versions WHERE id = $1 AND tenant_id = $2',
      [budgetVersionId, context.tenantId],
    );
    if ((versionExists.rowCount ?? 0) === 0) throw new BudgetGraphVersionNotFoundError(budgetVersionId);

    let parentType: BudgetGraphNodeType | null = null;
    if (input.parentId) {
      const parent = await this.client.query<{ nodeType: BudgetGraphNodeType }>(
        `SELECT node_type AS "nodeType" FROM budget_graph_nodes
         WHERE id = $1 AND tenant_id = $2 AND budget_version_id = $3`,
        [input.parentId, context.tenantId, budgetVersionId],
      );
      const row = parent.rows[0];
      if (!row) throw new BudgetGraphNodeNotFoundError(input.parentId);
      parentType = row.nodeType;
    }
    if (NODE_TYPE_PARENT[input.nodeType] !== parentType) {
      throw new BudgetGraphInvalidHierarchyError(input.nodeType, parentType);
    }

    if (input.workshopId) {
      const workshop = await this.client.query(
        'SELECT 1 FROM workshops WHERE id = $1 AND tenant_id = $2',
        [input.workshopId, context.tenantId],
      );
      if ((workshop.rowCount ?? 0) === 0) throw new BudgetGraphWorkshopNotFoundError(input.workshopId);
    }

    const nodeId = randomUUID();
    const result = await this.client.query<NodeRow>(
      `WITH created AS (
         INSERT INTO budget_graph_nodes (
           id, tenant_id, budget_version_id, parent_id, workshop_id, node_type, title,
           planned_amount, position_x, position_y, width, height, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12::numeric, NOW())
         RETURNING ${NODE_RAW_COLUMNS}
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $13, $2, $14, 'budget_graph_node.created', 'budget_graph_node', id,
           jsonb_build_object('nodeType', $6, 'title', $7)
         FROM created
       )
       SELECT ${NODE_COLUMNS} FROM created`,
      [
        nodeId,
        context.tenantId,
        budgetVersionId,
        input.parentId ?? null,
        input.workshopId ?? null,
        input.nodeType,
        input.title,
        input.plannedAmount,
        input.positionX,
        input.positionY,
        input.width,
        input.height,
        randomUUID(),
        context.membershipId,
      ],
    );

    return this.withSubtreeTotal(context, result.rows[0]!);
  }

  public async listNodes(context: TenantContext, budgetVersionId: string): Promise<StoredBudgetGraphNode[]> {
    const result = await this.client.query<NodeRow>(
      `SELECT ${NODE_COLUMNS} FROM budget_graph_nodes
       WHERE tenant_id = $1 AND budget_version_id = $2
       ORDER BY created_at ASC, id ASC`,
      [context.tenantId, budgetVersionId],
    );

    const totals = await this.subtreeTotals(context, budgetVersionId);
    const approved = await this.approvedTotals(context, budgetVersionId);
    return result.rows.map((row) => toStoredNode(
      row,
      totals.get(row.id) ?? '0.00',
      row.nodeType === 'workshop' ? approved.get(row.id) ?? '0.00' : null,
    ));
  }

  public async moveNode(
    context: TenantContext,
    nodeId: string,
    expectedRevision: number,
    layout: { positionX: string; positionY: string; width: string; height: string },
  ): Promise<StoredBudgetGraphNode | null> {
    const current = await this.requireCurrentRevision(context, nodeId, expectedRevision);
    if (current === null) return null;

    const result = await this.client.query<NodeRow>(
      `UPDATE budget_graph_nodes
       SET position_x = $3::numeric, position_y = $4::numeric, width = $5::numeric, height = $6::numeric,
           revision = revision + 1, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING ${NODE_COLUMNS}`,
      [nodeId, context.tenantId, layout.positionX, layout.positionY, layout.width, layout.height],
    );

    return this.withSubtreeTotal(context, result.rows[0]!);
  }

  public async updateNodeDetails(
    context: TenantContext,
    nodeId: string,
    expectedRevision: number,
    details: { title: string; plannedAmount: string },
  ): Promise<StoredBudgetGraphNode | null> {
    const current = await this.requireCurrentRevision(context, nodeId, expectedRevision);
    if (current === null) return null;

    const result = await this.client.query<NodeRow>(
      `WITH updated AS (
         UPDATE budget_graph_nodes
         SET title = $3, planned_amount = $4::numeric, revision = revision + 1, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING ${NODE_RAW_COLUMNS}
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $5, $2, $6, 'budget_graph_node.updated', 'budget_graph_node', id,
           jsonb_build_object('title', $3, 'plannedAmount', $4::numeric)
         FROM updated
       )
       SELECT ${NODE_COLUMNS} FROM updated`,
      [nodeId, context.tenantId, details.title, details.plannedAmount, randomUUID(), context.membershipId],
    );

    return this.withSubtreeTotal(context, result.rows[0]!);
  }

  public async reparentNode(
    context: TenantContext,
    nodeId: string,
    expectedRevision: number,
    newParentId: string | null,
  ): Promise<StoredBudgetGraphNode | null> {
    const current = await this.requireCurrentRevision(context, nodeId, expectedRevision);
    if (current === null) return null;

    let newParentType: BudgetGraphNodeType | null = null;
    if (newParentId) {
      if (newParentId === nodeId) throw new BudgetGraphCycleError(nodeId, newParentId);

      const check = await this.client.query<{
        nodeType: BudgetGraphNodeType | null;
        sameVersion: boolean;
        isDescendant: boolean;
      }>(
        `WITH RECURSIVE ancestors AS (
           SELECT id, parent_id, node_type, budget_version_id FROM budget_graph_nodes
           WHERE id = $1 AND tenant_id = $2
           UNION ALL
           SELECT o.id, o.parent_id, o.node_type, o.budget_version_id FROM budget_graph_nodes o
           JOIN ancestors a ON o.id = a.parent_id
           WHERE o.tenant_id = $2
         )
         SELECT
           (SELECT node_type FROM budget_graph_nodes WHERE id = $1 AND tenant_id = $2) AS "nodeType",
           (SELECT candidate.budget_version_id = moved.budget_version_id
            FROM budget_graph_nodes candidate, budget_graph_nodes moved
            WHERE candidate.id = $1 AND candidate.tenant_id = $2
              AND moved.id = $3 AND moved.tenant_id = $2) AS "sameVersion",
           EXISTS (SELECT 1 FROM ancestors WHERE id = $3) AS "isDescendant"`,
        [newParentId, context.tenantId, nodeId],
      );
      const row = check.rows[0];
      if (!row || row.nodeType === null) throw new BudgetGraphNodeNotFoundError(newParentId);
      if (!row.sameVersion) throw new BudgetGraphNodeNotFoundError(newParentId);
      if (row.isDescendant) throw new BudgetGraphCycleError(nodeId, newParentId);
      newParentType = row.nodeType;
    }

    const movedType = await this.client.query<{ nodeType: BudgetGraphNodeType }>(
      'SELECT node_type AS "nodeType" FROM budget_graph_nodes WHERE id = $1 AND tenant_id = $2',
      [nodeId, context.tenantId],
    );
    const nodeType = movedType.rows[0]!.nodeType;
    if (NODE_TYPE_PARENT[nodeType] !== newParentType) {
      throw new BudgetGraphInvalidHierarchyError(nodeType, newParentType);
    }

    const result = await this.client.query<NodeRow>(
      `WITH updated AS (
         UPDATE budget_graph_nodes
         SET parent_id = $3::uuid, revision = revision + 1, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING ${NODE_RAW_COLUMNS}
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $4, $2, $5, 'budget_graph_node.reparented', 'budget_graph_node', id,
           jsonb_build_object('newParentId', $3::uuid)
         FROM updated
       )
       SELECT ${NODE_COLUMNS} FROM updated`,
      [nodeId, context.tenantId, newParentId, randomUUID(), context.membershipId],
    );

    return this.withSubtreeTotal(context, result.rows[0]!);
  }

  public async deleteNode(
    context: TenantContext,
    nodeId: string,
    expectedRevision: number,
  ): Promise<{ deletedIds: string[] } | null> {
    const current = await this.requireCurrentRevision(context, nodeId, expectedRevision);
    if (current === null) return null;

    const result = await this.client.query<{ id: string }>(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM budget_graph_nodes WHERE id = $1 AND tenant_id = $2
         UNION ALL
         SELECT c.id FROM budget_graph_nodes c
         JOIN subtree s ON c.parent_id = s.id
         WHERE c.tenant_id = $2
       ), deleted AS (
         DELETE FROM budget_graph_nodes
         WHERE tenant_id = $2 AND id IN (SELECT id FROM subtree)
         RETURNING id
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $3, $2, $4, 'budget_graph_node.deleted', 'budget_graph_node', id, '{}'::jsonb
         FROM deleted
         WHERE id = $1
       )
       SELECT id FROM deleted`,
      [nodeId, context.tenantId, randomUUID(), context.membershipId],
    );

    return { deletedIds: result.rows.map((row) => row.id) };
  }

  private async requireCurrentRevision(
    context: TenantContext,
    nodeId: string,
    expectedRevision: number,
  ): Promise<number | null> {
    const result = await this.client.query<{ revision: number }>(
      'SELECT revision FROM budget_graph_nodes WHERE id = $1 AND tenant_id = $2',
      [nodeId, context.tenantId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.revision !== expectedRevision) {
      throw new BudgetGraphRevisionConflictError(nodeId, expectedRevision);
    }
    return row.revision;
  }

  private async withSubtreeTotal(context: TenantContext, row: NodeRow): Promise<StoredBudgetGraphNode> {
    const totals = await this.subtreeTotals(context, row.budgetVersionId);
    let approvedTotal: string | null = null;
    if (row.nodeType === 'workshop') {
      const approved = await this.approvedTotals(context, row.budgetVersionId);
      approvedTotal = approved.get(row.id) ?? '0.00';
    }
    return toStoredNode(row, totals.get(row.id) ?? '0.00', approvedTotal);
  }

  /**
   * Bottom-up leaf sum per node ("обход от листьев к production"): a leaf
   * contributes its own planned amount; every ancestor's total is the sum
   * of its descendant leaves' planned amounts.
   */
  private async subtreeTotals(context: TenantContext, budgetVersionId: string): Promise<Map<string, string>> {
    const result = await this.client.query<{ id: string; plannedAmount: string }>(
      `SELECT id, planned_amount AS "plannedAmount", parent_id AS "parentId"
       FROM budget_graph_nodes
       WHERE tenant_id = $1 AND budget_version_id = $2`,
      [context.tenantId, budgetVersionId],
    );

    const rows = result.rows as (typeof result.rows[number] & { parentId: string | null })[];
    const childrenOf = new Map<string | null, string[]>();
    const amountOf = new Map<string, string>();
    for (const row of rows) {
      amountOf.set(row.id, row.plannedAmount);
      const siblings = childrenOf.get(row.parentId) ?? [];
      siblings.push(row.id);
      childrenOf.set(row.parentId, siblings);
    }

    const totals = new Map<string, string>();
    const computeLeaves = (nodeId: string): string[] => {
      const children = childrenOf.get(nodeId);
      if (!children || children.length === 0) return [amountOf.get(nodeId)!];
      return children.flatMap((childId) => computeLeaves(childId));
    };
    for (const row of rows) {
      totals.set(row.id, sumMoney(computeLeaves(row.id)));
    }
    return totals;
  }

  /**
   * Согласованная сумма: sum of `planned_amount` for workshop-tasks that
   * were created directly against this graph node and whose lead decision
   * was 'approved'. Only meaningful for `workshop`-type nodes.
   */
  private async approvedTotals(context: TenantContext, budgetVersionId: string): Promise<Map<string, string>> {
    const result = await this.client.query<{ graphNodeId: string; plannedAmount: string }>(
      `SELECT t.graph_node_id AS "graphNodeId", t.planned_amount AS "plannedAmount"
       FROM workshop_tasks t
       JOIN budget_graph_nodes n ON n.id = t.graph_node_id AND n.tenant_id = t.tenant_id
       WHERE t.tenant_id = $1 AND n.budget_version_id = $2 AND t.status = 'approved'`,
      [context.tenantId, budgetVersionId],
    );

    const byNode = new Map<string, string[]>();
    for (const row of result.rows) {
      const amounts = byNode.get(row.graphNodeId) ?? [];
      amounts.push(row.plannedAmount);
      byNode.set(row.graphNodeId, amounts);
    }

    const totals = new Map<string, string>();
    for (const [nodeId, amounts] of byNode) {
      totals.set(nodeId, sumMoney(amounts));
    }
    return totals;
  }
}

function toStoredNode(row: NodeRow, subtreeTotal: string, approvedTotal: string | null): StoredBudgetGraphNode {
  return {
    id: row.id,
    budgetVersionId: row.budgetVersionId,
    parentId: row.parentId,
    workshopId: row.workshopId,
    nodeType: row.nodeType,
    title: row.title,
    plannedAmount: row.plannedAmount,
    subtreeTotal,
    approvedTotal,
    positionX: row.positionX,
    positionY: row.positionY,
    width: row.width,
    height: row.height,
    revision: row.revision,
  };
}
