'use client';

import { useState } from 'react';

interface Task {
  id: string;
  budgetItemId: string | null;
  productionId: string;
  workshopId: string;
  assigneeMembershipId: string | null;
  status: string;
  description: string;
  deadlineAt: string | null;
  completedAt: string | null;
}

interface MembershipOption {
  id: string;
  userEmail: string;
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Новая',
  assigned: 'Назначена',
  accepted: 'Принята',
  completed: 'Выполнена',
  closed: 'Закрыта',
};

export function TaskBoard({ initialTasks, memberships }: { initialTasks: Task[]; memberships: MembershipOption[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rescheduleOpenId, setRescheduleOpenId] = useState<string | null>(null);

  function updateTask(next: Task): void {
    setTasks((current) => current.map((task) => (task.id === next.id ? next : task)));
  }

  function setError(taskId: string, message: string | null): void {
    setErrors((current) => {
      const next = { ...current };
      if (message) next[taskId] = message;
      else delete next[taskId];
      return next;
    });
  }

  async function runAction(taskId: string, path: string, method: string, body?: unknown): Promise<void> {
    setPendingId(taskId);
    setError(taskId, null);
    try {
      const response = await fetch(`/api/proxy/${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(taskId, (payload as { message?: string } | null)?.message ?? `Ошибка ${response.status}`);
        return;
      }
      const task = (await response.json()) as Task;
      updateTask(task);
      setRescheduleOpenId(null);
    } catch {
      setError(taskId, 'Сеть недоступна. Попробуйте ещё раз.');
    } finally {
      setPendingId(null);
    }
  }

  if (tasks.length === 0) {
    return <p className="empty-state">У этого цеха пока нет задач.</p>;
  }

  return (
    <ul className="task-board">
      {tasks.map((task) => (
        <li key={task.id} className="task-row" data-testid="task-row">
          <div className="task-row__main">
            <span className={`status-pill status-pill--${task.status}`}>{STATUS_LABEL[task.status] ?? task.status}</span>
            <div className="task-row__body">
              <p className="task-row__description">{task.description}</p>
              <p className="muted task-row__meta">{formatDeadline(task.deadlineAt)}</p>
            </div>
          </div>

          <div className="task-actions">
            {task.status === 'new' && (
              <AssignForm
                taskId={task.id}
                memberships={memberships}
                pending={pendingId === task.id}
                onAssign={(assigneeMembershipId) =>
                  runAction(task.id, `workshop-tasks/${task.id}/assign`, 'PATCH', { assigneeMembershipId })
                }
              />
            )}
            {task.status === 'assigned' && (
              <button
                type="button"
                className="btn-pill btn-pill--accent"
                disabled={pendingId === task.id}
                onClick={() => runAction(task.id, `workshop-tasks/${task.id}/accept`, 'POST')}
              >
                Принять
              </button>
            )}
            {task.status === 'accepted' && (
              <button
                type="button"
                className="btn-pill btn-pill--accent"
                disabled={pendingId === task.id}
                onClick={() => runAction(task.id, `workshop-tasks/${task.id}/complete`, 'POST')}
              >
                Выполнено
              </button>
            )}
            {task.status === 'completed' && (
              <button
                type="button"
                className="btn-pill btn-pill--accent"
                disabled={pendingId === task.id}
                onClick={() => runAction(task.id, `workshop-tasks/${task.id}/close`, 'POST')}
              >
                Закрыть
              </button>
            )}
            {task.status !== 'closed' && (
              <button
                type="button"
                className="btn-pill btn-pill--ghost"
                onClick={() => setRescheduleOpenId(rescheduleOpenId === task.id ? null : task.id)}
              >
                Перенести срок
              </button>
            )}
          </div>

          {rescheduleOpenId === task.id && (
            <RescheduleForm
              pending={pendingId === task.id}
              onSubmit={(deadlineAt, reason) =>
                runAction(task.id, `workshop-tasks/${task.id}/deadline`, 'PATCH', { deadlineAt, reason })
              }
            />
          )}

          {errors[task.id] && (
            <p role="alert" className="task-row__error">
              {errors[task.id]}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function AssignForm({
  taskId,
  memberships,
  pending,
  onAssign,
}: {
  taskId: string;
  memberships: MembershipOption[];
  pending: boolean;
  onAssign: (assigneeMembershipId: string) => void;
}) {
  const [selected, setSelected] = useState('');

  return (
    <form
      className="assign-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (selected) onAssign(selected);
      }}
    >
      <label htmlFor={`assignee-${taskId}`} className="sr-only">
        Исполнитель
      </label>
      <select id={`assignee-${taskId}`} value={selected} onChange={(event) => setSelected(event.target.value)} required>
        <option value="" disabled>
          Выбрать исполнителя…
        </option>
        {memberships.map((membership) => (
          <option key={membership.id} value={membership.id}>
            {membership.userEmail}
          </option>
        ))}
      </select>
      <button type="submit" className="btn-pill btn-pill--accent" disabled={pending || !selected}>
        Назначить
      </button>
    </form>
  );
}

function RescheduleForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (deadlineAt: string | null, reason: string) => void;
}) {
  const [deadline, setDeadline] = useState('');
  const [reason, setReason] = useState('');

  return (
    <form
      className="reschedule-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(deadline || null, reason);
      }}
    >
      <label>
        <span className="sr-only">Новый срок</span>
        <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
      </label>
      <label>
        <span className="sr-only">Причина переноса</span>
        <input
          type="text"
          placeholder="Причина переноса (обязательно)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
        />
      </label>
      <button type="submit" className="btn-pill btn-pill--ghost" disabled={pending || reason.trim().length === 0}>
        Сохранить перенос
      </button>
    </form>
  );
}

function formatDeadline(deadlineAt: string | null): string {
  if (!deadlineAt) return 'Срок не назначен';
  const [datePart] = deadlineAt.split('T');
  const [year, month, day] = datePart!.split('-');
  return `Срок · ${day}.${month}.${year}`;
}
