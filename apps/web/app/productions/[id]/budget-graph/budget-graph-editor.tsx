'use client';

import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useState } from 'react';

type BudgetGraphNodeType = 'production' | 'workshop' | 'work' | 'material';

interface StoredBudgetGraphNode {
  id: string;
  budgetVersionId: string;
  parentId: string | null;
  workshopId: string | null;
  nodeType: BudgetGraphNodeType;
  title: string;
  plannedAmount: string;
  subtreeTotal: string;
  positionX: string;
  positionY: string;
  width: string;
  height: string;
  revision: number;
}

const NODE_TYPE_LABEL: Record<BudgetGraphNodeType, string> = {
  production: 'Спектакль',
  workshop: 'Цех',
  work: 'Работа',
  material: 'Материал',
};

const CHILD_TYPE: Record<BudgetGraphNodeType, BudgetGraphNodeType | null> = {
  production: 'workshop',
  workshop: 'work',
  work: 'material',
  material: null,
};

function BudgetGraphNodeCard({ data, selected }: NodeProps) {
  const node = data as unknown as StoredBudgetGraphNode;
  return (
    <div
      className={`graph-node${selected ? ' graph-node--selected' : ''}`}
      tabIndex={0}
      role="group"
      aria-label={`${NODE_TYPE_LABEL[node.nodeType]}: ${node.title}`}
    >
      <Handle type="target" position={Position.Top} />
      <span className="graph-node__type">{NODE_TYPE_LABEL[node.nodeType]}</span>
      <strong className="graph-node__title">{node.title}</strong>
      <div className="graph-node__stats">
        <div className="graph-node__stat">
          <span className="graph-node__stat-label">План</span>
          <span className="graph-node__stat-value">{node.plannedAmount} ₽</span>
        </div>
        <div className="graph-node__stat graph-node__stat--total">
          <span className="graph-node__stat-label">Сумма ветви</span>
          <span className="graph-node__stat-value">{node.subtreeTotal} ₽</span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const NODE_TYPES: NodeTypes = { budgetNode: BudgetGraphNodeCard };

export function BudgetGraphEditor({ budgetVersionId }: { budgetVersionId: string }) {
  const [items, setItems] = useState<StoredBudgetGraphNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'canvas' | 'table'>('canvas');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [formTitle, setFormTitle] = useState('');
  const [formAmount, setFormAmount] = useState('0.00');
  const [formParentId, setFormParentId] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editAmount, setEditAmount] = useState('0.00');
  const [saving, setSaving] = useState(false);

  const selectedNode = items.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedNode) {
      setEditTitle(selectedNode.title);
      setEditAmount(selectedNode.plannedAmount);
    }
  }, [selectedNode?.id, selectedNode?.title, selectedNode?.plannedAmount]);

  const load = useCallback(async () => {
    const response = await fetch(`/api/proxy/budget-versions/${budgetVersionId}/graph-nodes`);
    if (!response.ok) {
      setError('Не удалось загрузить граф сметы.');
      return;
    }
    setItems((await response.json()) as StoredBudgetGraphNode[]);
    setError(null);
  }, [budgetVersionId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const flowNodes: Node[] = useMemo(
    () =>
      items.map((node) => ({
        id: node.id,
        type: 'budgetNode',
        position: { x: Number(node.positionX), y: Number(node.positionY) },
        // Height is intentionally not forced here: the card's content
        // (title + two stat rows) dictates its real height, so a stale
        // stored height never clips it — width is still fixed for a
        // predictable canvas layout.
        style: { width: Number(node.width) },
        data: node as unknown as Record<string, unknown>,
        selected: node.id === selectedId,
      })),
    [items, selectedId],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      items
        .filter((node) => node.parentId)
        .map((node) => ({
          id: `${node.parentId}-${node.id}`,
          source: node.parentId!,
          target: node.id,
        })),
    [items],
  );

  async function handleNodeDragStop(_event: unknown, dragged: Node): Promise<void> {
    const current = items.find((node) => node.id === dragged.id);
    if (!current) return;

    const response = await fetch(`/api/proxy/budget-graph-nodes/${dragged.id}/layout`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: current.revision,
        positionX: dragged.position.x.toFixed(2),
        positionY: dragged.position.y.toFixed(2),
        width: current.width,
        height: current.height,
      }),
    });
    if (!response.ok) {
      setError('Не удалось сохранить позицию узла — карта могла измениться. Обновляем данные.');
      await load();
      return;
    }
    const updated = (await response.json()) as StoredBudgetGraphNode;
    setItems((current) => current.map((node) => (node.id === updated.id ? updated : node)));
  }

  async function handleConnect(connection: Connection): Promise<void> {
    const target = items.find((node) => node.id === connection.target);
    if (!target || !connection.source) return;

    const response = await fetch(`/api/proxy/budget-graph-nodes/${target.id}/parent`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: target.revision, parentId: connection.source }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      setError(payload?.message ?? 'Не удалось изменить связь узла.');
      return;
    }
    await load();
  }

  async function handleUpdateDetails(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!selectedNode) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/proxy/budget-graph-nodes/${selectedNode.id}/details`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: selectedNode.revision,
          title: editTitle,
          plannedAmount: editAmount,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(payload?.message ?? 'Не удалось сохранить узел — карта могла измениться. Обновляем данные.');
        await load();
        return;
      }
      const updated = (await response.json()) as StoredBudgetGraphNode;
      setItems((current) => current.map((node) => (node.id === updated.id ? updated : node)));
      setError(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!selectedId) return;
    const node = items.find((item) => item.id === selectedId);
    if (!node) return;
    if (!confirm(`Удалить «${node.title}» и все вложенные узлы?`)) return;

    const response = await fetch(
      `/api/proxy/budget-graph-nodes/${node.id}?expectedRevision=${node.revision}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      setError('Не удалось удалить узел.');
      return;
    }
    setSelectedId(null);
    await load();
  }

  async function handleCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const parent = items.find((node) => node.id === formParentId);
    const nodeType: BudgetGraphNodeType = parent ? (CHILD_TYPE[parent.nodeType] ?? 'production') : 'production';
    if (!parent && items.length > 0) {
      setError('Выберите родительский узел.');
      return;
    }

    const response = await fetch(`/api/proxy/budget-versions/${budgetVersionId}/graph-nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeType,
        title: formTitle,
        plannedAmount: formAmount,
        positionX: (Math.random() * 400).toFixed(2),
        positionY: (Math.random() * 400).toFixed(2),
        width: '180.00',
        height: '90.00',
        ...(parent ? { parentId: parent.id } : {}),
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      setError(payload?.message ?? 'Не удалось создать узел.');
      return;
    }
    setFormTitle('');
    setFormAmount('0.00');
    await load();
  }

  if (loading) return <p className="muted">Загрузка графа…</p>;

  const selectableParents = items.filter((node) => CHILD_TYPE[node.nodeType] !== null);

  return (
    <div className="budget-graph">
      <div className="budget-graph__toolbar">
        <form className="budget-graph__create-form" onSubmit={handleCreate}>
          <label>
            <span className="sr-only">Родительский узел</span>
            <select value={formParentId} onChange={(event) => setFormParentId(event.target.value)}>
              <option value="">{items.length === 0 ? 'Корневой узел (спектакль)' : 'Выберите родителя…'}</option>
              {selectableParents.map((node) => (
                <option key={node.id} value={node.id}>
                  {NODE_TYPE_LABEL[node.nodeType]}: {node.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Название узла</span>
            <input
              type="text"
              placeholder="Название"
              value={formTitle}
              onChange={(event) => setFormTitle(event.target.value)}
              required
            />
          </label>
          <label>
            <span className="sr-only">Плановая сумма</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={formAmount}
              onChange={(event) => setFormAmount(event.target.value)}
            />
          </label>
          <button type="submit" className="btn-pill btn-pill--accent">
            Добавить узел
          </button>
        </form>

        <div className="budget-graph__actions">
          <button
            type="button"
            className="btn-pill btn-pill--ghost"
            onClick={() => setViewMode(viewMode === 'canvas' ? 'table' : 'canvas')}
          >
            {viewMode === 'canvas' ? 'Табличный вид' : 'Канвас'}
          </button>
        </div>
      </div>

      {selectedNode && (
        <>
          <div className="budget-graph__backdrop" onClick={() => setSelectedId(null)} />
          <form className="budget-graph__side-panel" onSubmit={handleUpdateDetails}>
            <div className="budget-graph__side-panel-header">
              <span className="graph-node__type">{NODE_TYPE_LABEL[selectedNode.nodeType]}</span>
              <button
                type="button"
                className="icon-btn icon-btn--ghost"
                aria-label="Закрыть панель"
                onClick={() => setSelectedId(null)}
              >
                ✕
              </button>
            </div>

            <label className="budget-graph__side-panel-field">
              <span>Название</span>
              <input
                type="text"
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                required
              />
            </label>
            <label className="budget-graph__side-panel-field">
              <span>Плановая сумма, ₽</span>
              <input
                type="text"
                inputMode="decimal"
                value={editAmount}
                onChange={(event) => setEditAmount(event.target.value)}
              />
            </label>
            <p className="muted">
              Сумма ветви (сумма листьев ниже по дереву): <strong>{selectedNode.subtreeTotal} ₽</strong>
            </p>

            <div className="budget-graph__side-panel-actions">
              <button type="submit" className="btn-pill btn-pill--accent" disabled={saving}>
                Сохранить
              </button>
              <button type="button" className="btn-pill btn-pill--ghost" disabled={saving} onClick={handleDelete}>
                Удалить узел
              </button>
            </div>
          </form>
        </>
      )}

      {error && (
        <p role="alert" className="task-row__error">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <p className="empty-state">Узлов пока нет — добавьте корневой узел «спектакль» выше.</p>
      ) : viewMode === 'table' ? (
        <div className="table-scroll">
          <table className="productions-table" data-testid="budget-graph-table">
            <thead>
              <tr>
                <th scope="col">Тип</th>
                <th scope="col">Название</th>
                <th scope="col">Родитель</th>
                <th scope="col">План</th>
                <th scope="col">Сумма ветви</th>
              </tr>
            </thead>
            <tbody>
              {items.map((node) => (
                <tr
                  key={node.id}
                  data-testid="budget-graph-row"
                  aria-selected={node.id === selectedId}
                  onClick={() => setSelectedId(node.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="muted">{NODE_TYPE_LABEL[node.nodeType]}</td>
                  <td className="cell-title">{node.title}</td>
                  <td className="muted">{items.find((p) => p.id === node.parentId)?.title ?? '—'}</td>
                  <td>{node.plannedAmount} ₽</td>
                  <td>{node.subtreeTotal} ₽</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="budget-graph__canvas" data-testid="budget-graph-canvas">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            onNodeDragStop={handleNodeDragStop}
            onConnect={handleConnect}
            onNodeClick={(_event, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            minZoom={0.2}
            maxZoom={2}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      )}
    </div>
  );
}
