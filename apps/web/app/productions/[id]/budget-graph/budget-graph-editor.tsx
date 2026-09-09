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
  type NodeChange,
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
  approvedTotal: string | null;
  positionX: string;
  positionY: string;
  width: string;
  height: string;
  revision: number;
}

type TaskAssigneeStatus = 'pending' | 'done';
type TaskLeadDecision = 'approved' | 'rejected';

interface StoredTaskAssignee {
  membershipId: string;
  displayName: string;
  status: TaskAssigneeStatus;
  completedAt: string | null;
}

interface StoredWorkshopTaskWithAssignees {
  id: string;
  graphNodeId: string | null;
  status: string;
  description: string;
  plannedAmount: string | null;
  completedAt: string | null;
  assignees: StoredTaskAssignee[];
}

interface StoredNodeAttachment {
  id: string;
  nodeId: string;
  fileName: string;
  contentType: string;
  sizeBytes: string;
  uploadedByMembershipId: string;
  createdAt: string;
}

interface MembershipListItem {
  id: string;
  userEmail: string;
  status: 'ACTIVE' | 'INACTIVE';
}

const TASK_STATUS_LABEL: Record<string, string> = {
  new: 'На согласовании',
  approved: 'Принято',
  rejected: 'Отклонено',
};

function formatFileSize(sizeBytes: string): string {
  const bytes = Number(sizeBytes);
  if (!Number.isFinite(bytes)) return sizeBytes;
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
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

/**
 * Compares a node's own planned amount against its rolled-up subtree total
 * (both already computed, no WorkshopTask involved — unlike the "agreed
 * sum" color indicator in the plan, which is still gated on an unconfirmed
 * multi-assignee WorkshopTask model). Explicit rule from the user: over ->
 * red, exact match -> green; under is left unstyled (not specified).
 */
function budgetVarianceClass(node: StoredBudgetGraphNode): string {
  const planned = Number(node.plannedAmount);
  const subtree = Number(node.subtreeTotal);
  if (subtree > planned) return ' graph-node--over-budget';
  if (subtree === planned) return ' graph-node--on-budget';
  return '';
}

function BudgetGraphNodeCard({ data, selected }: NodeProps) {
  const node = data as unknown as StoredBudgetGraphNode;
  return (
    <div
      className={`graph-node${selected ? ' graph-node--selected' : ''}${budgetVarianceClass(node)}`}
      tabIndex={0}
      role="group"
      aria-label={`${NODE_TYPE_LABEL[node.nodeType]}: ${node.title}`}
    >
      <Handle type="target" position={Position.Left} />
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
        {node.approvedTotal !== null && (
          <div className="graph-node__stat">
            <span className="graph-node__stat-label">Согласовано</span>
            <span className="graph-node__stat-value">{node.approvedTotal} ₽</span>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
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
  const [formWorkshopId, setFormWorkshopId] = useState('');
  const [workshops, setWorkshops] = useState<{ id: string; name: string }[]>([]);
  const [editTitle, setEditTitle] = useState('');
  const [editAmount, setEditAmount] = useState('0.00');
  const [saving, setSaving] = useState(false);
  const [tasks, setTasks] = useState<StoredWorkshopTaskWithAssignees[]>([]);
  const [attachments, setAttachments] = useState<StoredNodeAttachment[]>([]);
  const [memberships, setMemberships] = useState<MembershipListItem[]>([]);
  const [taskDescription, setTaskDescription] = useState('');
  const [taskAmount, setTaskAmount] = useState('0.00');
  const [taskAssigneeIds, setTaskAssigneeIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

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

  useEffect(() => {
    fetch('/api/proxy/organization/memberships')
      .then((response) => (response.ok ? (response.json() as Promise<MembershipListItem[]>) : []))
      .then((list) => setMemberships(list.filter((membership) => membership.status === 'ACTIVE')))
      .catch(() => setMemberships([]));
    fetch('/api/proxy/organization/workshops')
      .then((response) => (response.ok ? (response.json() as Promise<{ id: string; name: string; isActive: boolean }[]>) : []))
      .then((list) => setWorkshops(list.filter((workshop) => workshop.isActive)))
      .catch(() => setWorkshops([]));
  }, []);

  const loadWorkshopExtras = useCallback(async (nodeId: string) => {
    const [tasksResponse, attachmentsResponse] = await Promise.all([
      fetch(`/api/proxy/budget-graph-nodes/${nodeId}/tasks`),
      fetch(`/api/proxy/budget-graph-nodes/${nodeId}/attachments`),
    ]);
    setTasks(tasksResponse.ok ? ((await tasksResponse.json()) as StoredWorkshopTaskWithAssignees[]) : []);
    setAttachments(attachmentsResponse.ok ? ((await attachmentsResponse.json()) as StoredNodeAttachment[]) : []);
  }, []);

  useEffect(() => {
    if (selectedNode?.nodeType === 'workshop') {
      loadWorkshopExtras(selectedNode.id);
    } else {
      setTasks([]);
      setAttachments([]);
    }
  }, [selectedNode?.id, selectedNode?.nodeType, loadWorkshopExtras]);

  const flowNodes: Node[] = useMemo(
    () =>
      items.map((node) => ({
        id: node.id,
        type: 'budgetNode',
        position: { x: Number(node.positionX), y: Number(node.positionY) },
        // Neither dimension is forced as an exact pixel box: the card is
        // responsive to its own content (title length, digit count in the
        // amounts) so it never clips or wraps awkwardly. Stored width only
        // sets a floor, keeping the canvas grid roughly predictable.
        style: { minWidth: Number(node.width) },
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

  // Without this, `nodes` is a controlled prop with no feedback loop: React
  // Flow moves the node visually during its own internal drag tracking, but
  // any unrelated re-render of this component (selection, saving state,
  // the edit-panel effect, ...) recomputes `flowNodes` from the *last
  // saved* item positions and snaps the node back mid-drag — the reported
  // jumpiness. Applying position changes into `items` as they happen keeps
  // the rendered position in sync with the live drag on every frame.
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    const moves = changes.filter(
      (change): change is Extract<NodeChange, { type: 'position' }> =>
        change.type === 'position' && change.position !== undefined,
    );
    if (moves.length === 0) return;

    setItems((current) => {
      const byId = new Map(moves.map((change) => [change.id, change.position!]));
      return current.map((node) => {
        const position = byId.get(node.id);
        if (!position) return node;
        return { ...node, positionX: position.x.toFixed(2), positionY: position.y.toFixed(2) };
      });
    });
  }, []);

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
      // A changed planned amount shifts the subtree total of every ancestor
      // up to the root, not just this node's own record — a full reload
      // (not a single-item patch) is what keeps those in sync.
      await load();
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
        ...(nodeType === 'workshop' && formWorkshopId ? { workshopId: formWorkshopId } : {}),
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      setError(payload?.message ?? 'Не удалось создать узел.');
      return;
    }
    setFormTitle('');
    setFormAmount('0.00');
    setFormWorkshopId('');
    await load();
  }

  function toggleTaskAssignee(membershipId: string): void {
    setTaskAssigneeIds((current) =>
      current.includes(membershipId)
        ? current.filter((id) => id !== membershipId)
        : [...current, membershipId],
    );
  }

  async function handleCreateTask(): Promise<void> {
    if (!selectedNode || taskAssigneeIds.length === 0) {
      setError('Выберите хотя бы одного исполнителя.');
      return;
    }

    const response = await fetch(`/api/proxy/budget-graph-nodes/${selectedNode.id}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        description: taskDescription,
        plannedAmount: taskAmount,
        assigneeMembershipIds: taskAssigneeIds,
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      setError(payload?.message ?? 'Не удалось создать задачу.');
      return;
    }
    setTaskDescription('');
    setTaskAmount('0.00');
    setTaskAssigneeIds([]);
    await loadWorkshopExtras(selectedNode.id);
  }

  async function handleMarkAssigneeDone(taskId: string, membershipId: string): Promise<void> {
    if (!selectedNode) return;
    const response = await fetch(`/api/proxy/workshop-tasks/${taskId}/assignees/${membershipId}/done`, {
      method: 'POST',
    });
    if (!response.ok) {
      setError('Не удалось отметить выполнение.');
      return;
    }
    await loadWorkshopExtras(selectedNode.id);
  }

  async function handleLeadDecision(taskId: string, decision: TaskLeadDecision): Promise<void> {
    if (!selectedNode) return;
    const response = await fetch(`/api/proxy/workshop-tasks/${taskId}/lead-decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    if (!response.ok) {
      setError('Не удалось зафиксировать решение по задаче.');
      return;
    }
    // A lead decision changes the node's "Согласовано" total — a full
    // reload keeps that stat (shown on the canvas card) in sync, same as
    // handleUpdateDetails does for subtreeTotal.
    await Promise.all([loadWorkshopExtras(selectedNode.id), load()]);
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selectedNode) return;

    setUploading(true);
    try {
      const response = await fetch(`/api/proxy/budget-graph-nodes/${selectedNode.id}/attachments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, contentType: file.type || 'application/octet-stream', sizeBytes: file.size }),
      });
      if (!response.ok) {
        setError('Не удалось подготовить загрузку файла.');
        return;
      }
      const { uploadUrl } = (await response.json()) as { uploadUrl: string };
      const uploaded = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!uploaded.ok) {
        setError('Не удалось загрузить файл в хранилище.');
        return;
      }
      await loadWorkshopExtras(selectedNode.id);
    } finally {
      setUploading(false);
    }
  }

  async function handleDownloadAttachment(attachmentId: string): Promise<void> {
    if (!selectedNode) return;
    const response = await fetch(`/api/proxy/budget-graph-nodes/${selectedNode.id}/attachments/${attachmentId}/download-url`);
    if (!response.ok) {
      setError('Не удалось получить ссылку на файл.');
      return;
    }
    const { url } = (await response.json()) as { url: string };
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function handleDeleteAttachment(attachmentId: string): Promise<void> {
    if (!selectedNode) return;
    const response = await fetch(`/api/proxy/budget-graph-nodes/${selectedNode.id}/attachments/${attachmentId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      setError('Не удалось удалить файл.');
      return;
    }
    await loadWorkshopExtras(selectedNode.id);
  }

  if (loading) return <p className="muted">Загрузка графа…</p>;

  const selectableParents = items.filter((node) => CHILD_TYPE[node.nodeType] !== null);
  const formParent = items.find((node) => node.id === formParentId);
  const pendingNodeType: BudgetGraphNodeType = formParent ? (CHILD_TYPE[formParent.nodeType] ?? 'production') : 'production';

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
          {pendingNodeType === 'workshop' && (
            <label>
              <span className="sr-only">Цех</span>
              <select value={formWorkshopId} onChange={(event) => setFormWorkshopId(event.target.value)}>
                <option value="">Связать с цехом (для задач)…</option>
                {workshops.map((workshop) => (
                  <option key={workshop.id} value={workshop.id}>
                    {workshop.name}
                  </option>
                ))}
              </select>
            </label>
          )}
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
            {selectedNode.approvedTotal !== null && (
              <p className="muted">
                Согласовано (принятые задачи цеха): <strong>{selectedNode.approvedTotal} ₽</strong>
              </p>
            )}

            {selectedNode.nodeType === 'workshop' && (
              <div className="budget-graph__side-panel-section">
                <h3>Файлы</h3>
                {attachments.length === 0 ? (
                  <p className="muted">Файлов пока нет.</p>
                ) : (
                  <ul className="budget-graph__attachment-list">
                    {attachments.map((attachment) => (
                      <li key={attachment.id} className="budget-graph__attachment-row">
                        <button
                          type="button"
                          className="budget-graph__attachment-name"
                          onClick={() => handleDownloadAttachment(attachment.id)}
                        >
                          {attachment.fileName}
                        </button>
                        <span className="muted">{formatFileSize(attachment.sizeBytes)}</span>
                        <button
                          type="button"
                          className="icon-btn icon-btn--ghost"
                          aria-label={`Удалить файл ${attachment.fileName}`}
                          onClick={() => handleDeleteAttachment(attachment.id)}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <label className="btn-pill btn-pill--ghost budget-graph__file-input-label">
                  {uploading ? 'Загрузка…' : 'Прикрепить файл'}
                  <input type="file" onChange={handleFileUpload} disabled={uploading} hidden />
                </label>
              </div>
            )}

            {selectedNode.nodeType === 'workshop' && (
              <div className="budget-graph__side-panel-section">
                <h3>Задачи цеха</h3>
                {tasks.length === 0 ? (
                  <p className="muted">Задач пока нет.</p>
                ) : (
                  <ul className="budget-graph__task-list">
                    {tasks.map((task) => (
                      <li key={task.id} className="budget-graph__task-card">
                        <div className="budget-graph__task-header">
                          <strong>{task.description}</strong>
                          <span className="muted">{task.plannedAmount} ₽</span>
                        </div>
                        <span className={`delta-pill delta-pill--${task.status === 'approved' ? 'positive' : task.status === 'rejected' ? 'negative' : 'neutral'}`}>
                          {TASK_STATUS_LABEL[task.status] ?? task.status}
                        </span>
                        <ul className="budget-graph__assignee-list">
                          {task.assignees.map((assignee) => (
                            <li key={assignee.membershipId} className="budget-graph__assignee-row">
                              <span className={`budget-graph__assignee-dot budget-graph__assignee-dot--${assignee.status}`} aria-hidden="true" />
                              <span>{assignee.displayName}</span>
                              {assignee.status === 'pending' && task.status === 'new' && (
                                <button
                                  type="button"
                                  className="btn-pill btn-pill--ghost btn-pill--small"
                                  onClick={() => handleMarkAssigneeDone(task.id, assignee.membershipId)}
                                >
                                  Отметить готово
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                        {task.status === 'new' && (
                          <div className="budget-graph__task-actions">
                            <button
                              type="button"
                              className="btn-pill btn-pill--accent btn-pill--small"
                              onClick={() => handleLeadDecision(task.id, 'approved')}
                            >
                              Принято
                            </button>
                            <button
                              type="button"
                              className="btn-pill btn-pill--ghost btn-pill--small"
                              onClick={() => handleLeadDecision(task.id, 'rejected')}
                            >
                              Отклонено
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="budget-graph__task-create">
                  <label className="budget-graph__side-panel-field">
                    <span>Новая задача</span>
                    <input
                      type="text"
                      placeholder="Описание"
                      value={taskDescription}
                      onChange={(event) => setTaskDescription(event.target.value)}
                    />
                  </label>
                  <label className="budget-graph__side-panel-field">
                    <span>Сумма, ₽</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={taskAmount}
                      onChange={(event) => setTaskAmount(event.target.value)}
                    />
                  </label>
                  <fieldset className="budget-graph__assignee-picker">
                    <legend>Исполнители</legend>
                    {memberships.map((membership) => (
                      <label key={membership.id} className="budget-graph__assignee-option">
                        <input
                          type="checkbox"
                          checked={taskAssigneeIds.includes(membership.id)}
                          onChange={() => toggleTaskAssignee(membership.id)}
                        />
                        {membership.userEmail}
                      </label>
                    ))}
                  </fieldset>
                  <button
                    type="button"
                    className="btn-pill btn-pill--accent btn-pill--small"
                    disabled={!taskDescription || taskAssigneeIds.length === 0}
                    onClick={handleCreateTask}
                  >
                    Создать задачу
                  </button>
                </div>
              </div>
            )}

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
            onNodesChange={handleNodesChange}
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
