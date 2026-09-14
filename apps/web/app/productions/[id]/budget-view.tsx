'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { CheckIcon, SortIcon, TicketIcon } from '../../icons.js';
import { pluralize } from '../../lib/format.js';
import { canRevertTask, currentStageLabel, stageVisualState } from '../../lib/task-stages.js';
import { useEscapeToClose } from '../../lib/use-escape-to-close.js';
import type { Budget, WorkshopTask } from '../../lib/mock-data.js';
import { AddStageForm, EditStageForm, TaskDecisionButtons } from '../../task-stage-controls.js';

const BUDGET_STATUS_LABEL: Record<string, string> = {
  PRELIMINARY: 'Предварительная',
  DETAILED: 'Подробная',
  APPROVED: 'Утверждённая',
};

const CALENDAR_DAY_COUNT = 100;

type DayCellStatus = 'done' | 'overdue' | 'in-progress' | 'rejected' | null;

function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function addDaysUTC(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function formatDayLabel(dateOnly: string): string {
  const [, month, day] = dateOnly.split('-');
  return `${day}.${month}`;
}

function dayCellStatus(tasksForDay: WorkshopTask[], day: string, today: string): DayCellStatus {
  if (tasksForDay.length === 0) return null;
  if (tasksForDay.every((task) => task.rejectedAt !== null)) return 'rejected';
  if (tasksForDay.every((task) => task.completedAt !== null || task.rejectedAt !== null)) return 'done';
  return day < today ? 'overdue' : 'in-progress';
}

function isWeekend(dateOnly: string): boolean {
  const [year, month, day] = dateOnly.split('-').map(Number) as [number, number, number];
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

function dayNumberLabel(dateOnly: string): string {
  return dateOnly.slice(8, 10);
}

/** Every date from `startDay` to `endDay` inclusive, both `YYYY-MM-DD` — a
 * task's range fills every day-cell it spans, not just its deadline day.
 * Capped at a year as a sanity guard against malformed ranges; the API
 * already rejects a start date after the deadline. */
function enumerateDays(startDay: string, endDay: string): string[] {
  const result: string[] = [];
  let cursor = startDay;
  let guard = 0;
  while (cursor <= endDay && guard < 366) {
    result.push(cursor);
    cursor = addDaysUTC(cursor, 1);
    guard += 1;
  }
  return result;
}

function formatTaskRange(task: WorkshopTask): string {
  if (!task.deadlineAt) return 'Без срока';
  const end = toDateOnly(task.deadlineAt);
  const start = task.startAt ? toDateOnly(task.startAt) : end;
  return start === end ? formatDayLabel(end) : `${formatDayLabel(start)} – ${formatDayLabel(end)}`;
}

interface CreateWorkshopTaskInput {
  workshopId: string;
  description: string;
  startAt: string;
  deadlineAt: string;
  assigneeMembershipId?: string;
}

type MembershipOption = { id: string; userEmail: string; status: string };
type WorkshopOption = { id: string; name: string; isActive: boolean; parentWorkshopId: string | null };

/**
 * A single task's lifecycle as a vertical stepper — visual style requested
 * by the user via a reference screenshot of a document e-signing flow.
 * `task.stages` is now an arbitrary, user-extendable ordered list (see
 * lib/task-stages.ts) instead of a fixed 5-value status; the "Принять /
 * Вернуть в работу / Отклонить" row (TaskDecisionButtons, shared with
 * workshops/[id]/task-board.tsx) sits inside whichever stage is currently
 * in progress, and also on the last stage once the task is fully done
 * (nothing stays "in progress" at that point, but revert/reject still
 * apply there).
 */
function TaskDetailStepper({
  task,
  memberships,
  onUpdated,
}: {
  task: WorkshopTask;
  memberships: MembershipOption[];
  onUpdated: (task: WorkshopTask) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assigneeChoice, setAssigneeChoice] = useState('');
  const [addingStage, setAddingStage] = useState(false);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);

  const assignee = memberships.find((membership) => membership.id === task.assigneeMembershipId);

  async function runAction(path: string, method: string, body?: unknown): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/proxy/${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(payload?.message ?? `Ошибка ${response.status}`);
        return;
      }
      onUpdated((await response.json()) as WorkshopTask);
      setAddingStage(false);
      setEditingStageId(null);
    } catch {
      setError('Сеть недоступна. Попробуйте ещё раз.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="task-stepper">
      {!assignee && !task.rejectedAt && (
        <form
          className="task-stepper__action"
          onSubmit={(event) => {
            event.preventDefault();
            if (assigneeChoice) {
              void runAction(`workshop-tasks/${task.id}/assign`, 'PATCH', { assigneeMembershipId: assigneeChoice });
            }
          }}
        >
          <select value={assigneeChoice} onChange={(event) => setAssigneeChoice(event.target.value)} required>
            <option value="" disabled>
              Выбрать исполнителя…
            </option>
            {memberships.map((membership) => (
              <option key={membership.id} value={membership.id}>
                {membership.userEmail}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-pill btn-pill--accent btn-pill--small" disabled={pending || !assigneeChoice}>
            Назначить
          </button>
        </form>
      )}

      {task.stages.map((stage, index) => {
        const state = stageVisualState(stage);
        const isLastStage = index === task.stages.length - 1;
        const showDecisions = !task.rejectedAt && (state === 'current' || (isLastStage && task.completedAt !== null));
        return (
          <div key={stage.id} className={`task-stepper__step task-stepper__step--${state}`}>
            <span className="task-stepper__rail" aria-hidden="true">
              <span className="task-stepper__dot">{state === 'done' && <CheckIcon />}</span>
              {!isLastStage && <span className="task-stepper__line" />}
            </span>
            <div className="task-stepper__content">
              <p className="task-stepper__state">
                {state === 'done' ? 'Выполнено' : state === 'current' ? 'Текущий этап' : 'Ожидает'}
              </p>

              {editingStageId === stage.id ? (
                <EditStageForm
                  initialLabel={stage.label}
                  submitting={pending}
                  onCancel={() => setEditingStageId(null)}
                  onSubmit={(label) => void runAction(`workshop-tasks/${task.id}/stages/${stage.id}`, 'PATCH', { label })}
                />
              ) : (
                <p className="task-stepper__label">
                  {stage.label}
                  {!task.rejectedAt && (
                    <button
                      type="button"
                      className="details-link task-stepper__edit-trigger"
                      onClick={() => setEditingStageId(stage.id)}
                    >
                      Изменить
                    </button>
                  )}
                </p>
              )}

              {index > 0 && assignee && (
                <div className="task-stepper__person">
                  <span className="task-stepper__avatar" aria-hidden="true">
                    {assignee.userEmail.charAt(0).toUpperCase()}
                  </span>
                  <span>{assignee.userEmail}</span>
                </div>
              )}

              {showDecisions && (
                <TaskDecisionButtons
                  disabled={pending}
                  canRevert={canRevertTask(task)}
                  onAdvance={() => void runAction(`workshop-tasks/${task.id}/advance`, 'POST')}
                  onRevert={() => void runAction(`workshop-tasks/${task.id}/revert`, 'POST')}
                  onReject={() => void runAction(`workshop-tasks/${task.id}/reject`, 'POST')}
                />
              )}
            </div>
          </div>
        );
      })}

      {task.rejectedAt ? (
        <p className="task-stepper__rejected-note">Задача отклонена.</p>
      ) : addingStage ? (
        <AddStageForm
          submitting={pending}
          onSubmit={(label) => void runAction(`workshop-tasks/${task.id}/stages`, 'POST', { label })}
        />
      ) : (
        <button type="button" className="btn-pill btn-pill--ghost btn-pill--small" onClick={() => setAddingStage(true)}>
          + Добавить этап
        </button>
      )}

      {error && (
        <p role="alert" className="task-row__error">
          {error}
        </p>
      )}
    </div>
  );
}

const CELL_TOOLTIP_WIDTH = 240;
const CELL_TOOLTIP_MARGIN = 12;
const CELL_TOOLTIP_ESTIMATED_HEIGHT = 220;

interface HoveredCell {
  title: string;
  day: string;
  tasks: WorkshopTask[];
  top: number;
  left: number;
  placement: 'below' | 'above';
}

/** Anchors the tooltip to a cell's on-screen rect, clamped so a cell near
 * the grid's right edge or the page's bottom doesn't push the cloud off
 * screen — flips above the cell when there isn't room below instead. */
function placeCellTooltip(anchorRect: DOMRect): Pick<HoveredCell, 'top' | 'left' | 'placement'> {
  const left = Math.min(
    Math.max(anchorRect.left + anchorRect.width / 2, CELL_TOOLTIP_WIDTH / 2 + CELL_TOOLTIP_MARGIN),
    window.innerWidth - CELL_TOOLTIP_WIDTH / 2 - CELL_TOOLTIP_MARGIN,
  );
  const fitsBelow = anchorRect.bottom + CELL_TOOLTIP_ESTIMATED_HEIGHT + CELL_TOOLTIP_MARGIN < window.innerHeight;
  return {
    left,
    top: fitsBelow ? anchorRect.bottom + 8 : anchorRect.top - 8,
    placement: fitsBelow ? 'below' : 'above',
  };
}

/** A task's lifecycle as a compact dot rail — one dot per `task.stages`
 * entry (an arbitrary, user-extendable list, not a fixed 5), shrunk down
 * for the hover cloud (no actions, just "how far along is this task and
 * which stage is it on right now"). */
function MiniStepIndicator({ task }: { task: WorkshopTask }) {
  return (
    <span className="cell-tooltip__steps" role="img" aria-label={`Этап: ${currentStageLabel(task)}`}>
      {task.stages.map((stage) => {
        const state = stageVisualState(stage);
        return (
          <span
            key={stage.id}
            aria-hidden="true"
            className={`cell-tooltip__step-dot${state !== 'pending' ? ` cell-tooltip__step-dot--${state}` : ''}`}
          />
        );
      })}
    </span>
  );
}

/** Rendered via a portal into `document.body` — the grid's horizontal
 * scroll container clips absolutely-positioned children that stray outside
 * its own box, and a cell's own `:hover` scale transform would otherwise
 * turn a `position: fixed` descendant into one anchored to the cell instead
 * of the viewport. Escaping the DOM tree sidesteps both. */
function CellTooltip({ cell }: { cell: HoveredCell }) {
  return createPortal(
    <div
      className="cell-tooltip"
      role="tooltip"
      style={{
        top: cell.top,
        left: cell.left,
        transform: cell.placement === 'below' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
      }}
    >
      <div className="cell-tooltip__header">
        <strong>{cell.title}</strong>
        <span className="muted">
          {formatDayLabel(cell.day)} · {cell.tasks.length} {pluralize(cell.tasks.length, 'задача', 'задачи', 'задач')}
        </span>
      </div>
      <ul className="cell-tooltip__list">
        {cell.tasks.map((task) => (
          <li key={task.id} className="cell-tooltip__item">
            <p className="cell-tooltip__item-title">{task.description}</p>
            <MiniStepIndicator task={task} />
            <p className="cell-tooltip__item-status">Сейчас: {currentStageLabel(task)}</p>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}

function BudgetCalendarBoard({
  workshops,
  tasks,
  startDate,
  onCreateTask,
  onTaskUpdated,
}: {
  workshops: [string, string][];
  tasks: WorkshopTask[];
  startDate: string;
  onCreateTask: (input: CreateWorkshopTaskInput) => Promise<boolean>;
  onTaskUpdated: (task: WorkshopTask) => void;
}) {
  const today = toDateOnly(new Date().toISOString());
  const days = useMemo(
    () => Array.from({ length: CALENDAR_DAY_COUNT }, (_, index) => addDaysUTC(startDate, index)),
    [startDate],
  );

  const tasksByWorkshopAndDay = useMemo(() => {
    const map = new Map<string, Map<string, WorkshopTask[]>>();
    for (const task of tasks) {
      if (!task.deadlineAt) continue;
      const end = toDateOnly(task.deadlineAt);
      const start = task.startAt ? toDateOnly(task.startAt) : end;
      const byDay = map.get(task.workshopId) ?? new Map<string, WorkshopTask[]>();
      for (const day of enumerateDays(start, end)) {
        const dayTasks = byDay.get(day) ?? [];
        dayTasks.push(task);
        byDay.set(day, dayTasks);
      }
      map.set(task.workshopId, byDay);
    }
    return map;
  }, [tasks]);

  const [allWorkshops, setAllWorkshops] = useState<WorkshopOption[]>([]);
  const [extraWorkshops, setExtraWorkshops] = useState<[string, string][]>([]);
  const [addingDepartment, setAddingDepartment] = useState(false);
  const [pickedWorkshopId, setPickedWorkshopId] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ workshopId: string; title: string; day: string } | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<HoveredCell | null>(null);
  const [allMemberships, setAllMemberships] = useState<MembershipOption[]>([]);
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState('');
  const [newTaskStartAt, setNewTaskStartAt] = useState('');
  const [newTaskEndAt, setNewTaskEndAt] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [createTaskError, setCreateTaskError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/proxy/organization/workshops')
      .then((response) => (response.ok ? (response.json() as Promise<WorkshopOption[]>) : []))
      .then(setAllWorkshops)
      .catch(() => setAllWorkshops([]));
    fetch('/api/proxy/organization/memberships')
      .then((response) => (response.ok ? (response.json() as Promise<{ id: string; userEmail: string; status: string }[]>) : []))
      .then((list) => setAllMemberships(list.filter((membership) => membership.status === 'ACTIVE')))
      .catch(() => setAllMemberships([]));
  }, []);

  const rows = useMemo(() => [...workshops, ...extraWorkshops], [workshops, extraWorkshops]);
  const availableToAdd = useMemo(
    () => allWorkshops.filter((workshop) => workshop.isActive && !rows.some(([id]) => id === workshop.id)),
    [allWorkshops, rows],
  );

  /** Sub-departments — a department (цех) can itself have child departments
   * (`parentWorkshopId`, real hierarchy in the DB, not just a calendar-only
   * grouping). Rows explicitly included (budget sections + "+ Добавить
   * отдел") act as tree roots; every active child/grandchild/… comes along
   * automatically, indented, with its own expand/collapse. */
  const childrenByParent = useMemo(() => {
    const map = new Map<string, WorkshopOption[]>();
    for (const workshop of allWorkshops) {
      if (!workshop.isActive || !workshop.parentWorkshopId) continue;
      const list = map.get(workshop.parentWorkshopId) ?? [];
      list.push(workshop);
      map.set(workshop.parentWorkshopId, list);
    }
    return map;
  }, [allWorkshops]);

  const filteredRoots = useMemo(
    () => rows.filter(([, title]) => title.toLowerCase().includes(departmentFilter.trim().toLowerCase())),
    [rows, departmentFilter],
  );

  const visibleRows = useMemo(() => {
    const result: { workshopId: string; title: string; depth: number; hasChildren: boolean }[] = [];
    const visited = new Set<string>();
    function visit(id: string, title: string, depth: number): void {
      if (visited.has(id)) return;
      visited.add(id);
      const children = childrenByParent.get(id) ?? [];
      result.push({ workshopId: id, title, depth, hasChildren: children.length > 0 });
      if (children.length > 0 && !collapsedIds.has(id)) {
        for (const child of children) visit(child.id, child.name, depth + 1);
      }
    }
    for (const [id, title] of filteredRoots) visit(id, title, 0);
    return result;
  }, [filteredRoots, childrenByParent, collapsedIds]);

  function toggleCollapse(workshopId: string): void {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(workshopId)) next.delete(workshopId);
      else next.add(workshopId);
      return next;
    });
  }

  function handleAddDepartment(): void {
    const workshop = allWorkshops.find((item) => item.id === pickedWorkshopId);
    if (!workshop) return;
    setExtraWorkshops((current) => [...current, [workshop.id, workshop.name]]);
    setPickedWorkshopId('');
    setAddingDepartment(false);
  }

  const selectedTasks = selected ? tasksByWorkshopAndDay.get(selected.workshopId)?.get(selected.day) ?? [] : [];
  const selectedTask = selectedTaskId ? (tasks.find((task) => task.id === selectedTaskId) ?? null) : null;
  const rangeInvalid = Boolean(newTaskStartAt && newTaskEndAt && newTaskStartAt > newTaskEndAt);

  function openCell(workshopId: string, title: string, day: string): void {
    setSelected({ workshopId, title, day });
    setSelectedTaskId(null);
    setNewTaskDescription('');
    setNewTaskAssigneeId('');
    setNewTaskStartAt(day);
    setNewTaskEndAt(day);
    setCreateTaskError(null);
  }

  function closeModal(): void {
    setSelected(null);
    setSelectedTaskId(null);
  }

  function handleCellHover(event: React.MouseEvent<HTMLButtonElement>, title: string, day: string, dayTasks: WorkshopTask[]): void {
    if (dayTasks.length === 0) return;
    setHoveredCell({ title, day, tasks: dayTasks, ...placeCellTooltip(event.currentTarget.getBoundingClientRect()) });
  }

  function handleCellLeave(): void {
    setHoveredCell(null);
  }

  useEscapeToClose(Boolean(selected), closeModal);

  async function handleCreateTaskSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!selected || !newTaskDescription || !newTaskStartAt || !newTaskEndAt || rangeInvalid || creatingTask) return;

    setCreatingTask(true);
    setCreateTaskError(null);
    try {
      const ok = await onCreateTask({
        workshopId: selected.workshopId,
        description: newTaskDescription,
        startAt: newTaskStartAt,
        deadlineAt: newTaskEndAt,
        ...(newTaskAssigneeId ? { assigneeMembershipId: newTaskAssigneeId } : {}),
      });
      if (!ok) {
        setCreateTaskError('Не удалось поставить задачу.');
        return;
      }
      setNewTaskDescription('');
      setNewTaskAssigneeId('');
      setNewTaskStartAt(selected.day);
      setNewTaskEndAt(selected.day);
    } finally {
      setCreatingTask(false);
    }
  }

  return (
    <section className="budget-gantt" aria-label="Календарь задач по дням">
      <div className="budget-gantt__header">
        <h3>Календарь</h3>
        <p className="muted budget-gantt__hint">
          {CALENDAR_DAY_COUNT} дней от {formatDayLabel(startDate)} — зелёный: все задачи дня выполнены, жёлтый: в
          работе, красный: просрочены. Клик по ячейке показывает задачи дня.
        </p>
        <div className="budget-gantt__add">
          {addingDepartment ? (
            <>
              <select value={pickedWorkshopId} onChange={(event) => setPickedWorkshopId(event.target.value)}>
                <option value="">Выберите цех…</option>
                {availableToAdd.map((workshop) => (
                  <option key={workshop.id} value={workshop.id}>
                    {workshop.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-pill btn-pill--accent btn-pill--small"
                disabled={!pickedWorkshopId}
                onClick={handleAddDepartment}
              >
                Добавить
              </button>
              <button
                type="button"
                className="btn-pill btn-pill--ghost btn-pill--small"
                onClick={() => setAddingDepartment(false)}
              >
                Отмена
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-pill btn-pill--ghost btn-pill--small"
              onClick={() => setAddingDepartment(true)}
            >
              + Добавить отдел
            </button>
          )}
        </div>
      </div>

      <div className="budget-gantt__scroll">
        <div className="budget-gantt__grid">
          <div className="budget-gantt__row budget-gantt__row--header">
            <span className="budget-gantt__row-label budget-gantt__row-label--header">
              <input
                type="search"
                className="budget-gantt__search"
                placeholder="Поиск отдела…"
                value={departmentFilter}
                onChange={(event) => setDepartmentFilter(event.target.value)}
              />
            </span>
            <div className="budget-gantt__cells budget-gantt__cells--header">
              {days.map((day) => (
                <span
                  key={day}
                  className={`budget-gantt__day-number${isWeekend(day) ? ' budget-gantt__day-number--weekend' : ''}`}
                >
                  {dayNumberLabel(day)}
                </span>
              ))}
            </div>
          </div>

          {visibleRows.length === 0 ? (
            <p className="empty-state">Ничего не найдено — измените поиск.</p>
          ) : (
            visibleRows.map(({ workshopId, title, depth, hasChildren }) => {
              const byDay = tasksByWorkshopAndDay.get(workshopId);
              return (
                <div key={workshopId} className="budget-gantt__row">
                  <span
                    className="budget-gantt__row-label"
                    style={depth > 0 ? { paddingLeft: depth * 18 } : undefined}
                  >
                    {hasChildren ? (
                      <button
                        type="button"
                        className="budget-gantt__row-toggle"
                        aria-label={collapsedIds.has(workshopId) ? 'Развернуть под-отделы' : 'Свернуть под-отделы'}
                        onClick={() => toggleCollapse(workshopId)}
                      >
                        {collapsedIds.has(workshopId) ? '+' : '−'}
                      </button>
                    ) : (
                      depth > 0 && <span className="budget-gantt__row-toggle budget-gantt__row-toggle--leaf" aria-hidden="true" />
                    )}
                    {title}
                  </span>
                  <div className="budget-gantt__cells">
                    {days.map((day) => {
                      const dayTasks = byDay?.get(day) ?? [];
                      const status = dayCellStatus(dayTasks, day, today);
                      const isSelected = selected?.workshopId === workshopId && selected.day === day;
                      return (
                        <button
                          key={day}
                          type="button"
                          className={`budget-gantt__cell${status ? ` budget-gantt__cell--${status}` : ''}${isSelected ? ' budget-gantt__cell--selected' : ''}${isWeekend(day) ? ' budget-gantt__cell--weekend' : ''}`}
                          aria-label={`${title}, ${formatDayLabel(day)}${dayTasks.length > 0 ? ` — ${dayTasks.length} ${pluralize(dayTasks.length, 'задача', 'задачи', 'задач')}` : ''}`}
                          onClick={() => openCell(workshopId, title, day)}
                          onMouseEnter={(event) => handleCellHover(event, title, day, dayTasks)}
                          onMouseLeave={handleCellLeave}
                        >
                          {dayTasks.length > 0 && (
                            <span className="budget-gantt__cell-count" aria-hidden="true">
                              {dayTasks.length}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {hoveredCell && !selected && <CellTooltip cell={hoveredCell} />}

      {selected && (
        <div className="task-modal-backdrop" onClick={closeModal}>
          <div
            className="day-tasks-panel"
            role="dialog"
            aria-label="Задачи дня"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="task-modal__header">
              {selectedTask ? (
                <div className="task-modal__header-left">
                  <button
                    type="button"
                    className="icon-btn icon-btn--ghost"
                    aria-label="Назад к списку"
                    onClick={() => setSelectedTaskId(null)}
                  >
                    ←
                  </button>
                  <span className="task-modal__title">{selectedTask.description}</span>
                </div>
              ) : (
                <span className="task-modal__title">
                  {selected.title} <span className="muted">· {formatDayLabel(selected.day)}</span>
                </span>
              )}
              <button type="button" className="icon-btn icon-btn--ghost" aria-label="Закрыть" onClick={closeModal}>
                ✕
              </button>
            </div>

            {selectedTask ? (
              <div className="task-modal__body">
                <p className="task-stepper__range muted">{formatTaskRange(selectedTask)}</p>
                <TaskDetailStepper task={selectedTask} memberships={allMemberships} onUpdated={onTaskUpdated} />
              </div>
            ) : (
              <form className="task-modal__form" onSubmit={handleCreateTaskSubmit}>
                <div className="task-modal__body">
                  <section>
                    <h4 className="task-modal__section-title">Задачи дня</h4>
                    {selectedTasks.length === 0 ? (
                      <p className="muted">Задач на этот день нет.</p>
                    ) : (
                      <ul className="budget-gantt__detail-list">
                        {selectedTasks.map((task) => (
                          <li key={task.id}>
                            <button
                              type="button"
                              className="budget-gantt__detail-item"
                              onClick={() => setSelectedTaskId(task.id)}
                            >
                              <span>{task.description}</span>
                              <span className="muted">{currentStageLabel(task)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="task-modal__create">
                    <h4 className="task-modal__section-title">Новая задача</h4>
                    <label className="task-modal__field">
                      <span>Название задачи</span>
                      <input
                        type="text"
                        placeholder="Введите название задачи"
                        value={newTaskDescription}
                        onChange={(event) => setNewTaskDescription(event.target.value)}
                        required
                      />
                    </label>
                    <label className="task-modal__field">
                      <span>Ответственный</span>
                      <select value={newTaskAssigneeId} onChange={(event) => setNewTaskAssigneeId(event.target.value)}>
                        <option value="">Без ответственного</option>
                        {allMemberships.map((membership) => (
                          <option key={membership.id} value={membership.id}>
                            {membership.userEmail}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="task-modal__field-row">
                      <label className="task-modal__field">
                        <span>С</span>
                        <input
                          type="date"
                          value={newTaskStartAt}
                          onChange={(event) => setNewTaskStartAt(event.target.value)}
                          required
                        />
                      </label>
                      <label className="task-modal__field">
                        <span>По</span>
                        <input
                          type="date"
                          value={newTaskEndAt}
                          onChange={(event) => setNewTaskEndAt(event.target.value)}
                          required
                        />
                      </label>
                    </div>
                    {rangeInvalid && <p className="task-row__error">Дата начала позже даты окончания.</p>}
                    {createTaskError && (
                      <p role="alert" className="task-row__error">
                        {createTaskError}
                      </p>
                    )}
                  </section>
                </div>

                <div className="task-modal__footer">
                  <button
                    type="submit"
                    className="btn-pill btn-pill--accent"
                    disabled={!newTaskDescription || !newTaskStartAt || !newTaskEndAt || rangeInvalid || creatingTask}
                  >
                    {creatingTask ? 'Ставим…' : 'Поставить задачу'}
                  </button>
                  <button type="button" className="btn-pill btn-pill--ghost" onClick={closeModal}>
                    Отмена
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

type ViewTab = 'items' | 'calendar';

export function BudgetView({ budget, workshopTasks }: { budget: Budget; workshopTasks: WorkshopTask[] }) {
  const [workshopFilter, setWorkshopFilter] = useState('');
  const [activeTab, setActiveTab] = useState<ViewTab>('items');
  const [tasks, setTasks] = useState<WorkshopTask[]>(workshopTasks);

  async function handleCreateTask(input: CreateWorkshopTaskInput): Promise<boolean> {
    const response = await fetch(`/api/proxy/productions/${budget.productionId}/workshop-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) return false;

    const refreshed = await fetch(`/api/proxy/productions/${budget.productionId}/workshop-tasks`);
    if (refreshed.ok) {
      setTasks((await refreshed.json()) as WorkshopTask[]);
    }
    return true;
  }

  function handleTaskUpdated(updated: WorkshopTask): void {
    setTasks((current) => current.map((task) => (task.id === updated.id ? updated : task)));
  }

  const workshopOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const section of budget.sections) {
      if (!seen.has(section.workshopId)) seen.set(section.workshopId, section.title);
    }
    return [...seen.entries()];
  }, [budget.sections]);

  const visibleSections = workshopFilter
    ? budget.sections.filter((section) => section.workshopId === workshopFilter)
    : budget.sections;

  const isPreliminary = budget.status === 'PRELIMINARY';

  return (
    <div className="budget-view">
      <div className="table-card__header budget-view__header">
        <div className="budget-view__header-left">
          <div className="donut-card__header-text">
            <span className="stat-card__icon">
              <TicketIcon />
            </span>
            <h2>Смета</h2>
          </div>

          <div className="budget-tabs" role="tablist" aria-label="Вид сметы">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'items'}
              className={`budget-tab${activeTab === 'items' ? ' budget-tab--active' : ''}`}
              onClick={() => setActiveTab('items')}
            >
              Позиции
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'calendar'}
              className={`budget-tab${activeTab === 'calendar' ? ' budget-tab--active' : ''}`}
              onClick={() => setActiveTab('calendar')}
            >
              Календарь
            </button>
          </div>
        </div>

        <div className="budget-view__header-right">
          <div className="budget-total">
            <div className="budget-total__meta">
              <span
                className="status-pill"
                data-testid="budget-status"
                data-budget-status={budget.status}
              >
                {BUDGET_STATUS_LABEL[budget.status] ?? budget.status}
              </span>
              <span className="muted">Ревизия {budget.revision}</span>
            </div>
            <div>
              <span className="muted">Итого по смете</span> <strong>{budget.total} ₽</strong>
            </div>
          </div>

          <Link href={`/productions/${budget.productionId}/budget-graph`} className="details-link">
            Конструктор узлов
          </Link>
        </div>
      </div>

      {activeTab === 'calendar' ? (
        workshopOptions.length > 0 ? (
          <BudgetCalendarBoard
            workshops={workshopOptions}
            tasks={tasks}
            startDate={toDateOnly(budget.createdAt)}
            onCreateTask={handleCreateTask}
            onTaskUpdated={handleTaskUpdated}
          />
        ) : (
          <p className="empty-state">Нет отделов для отображения в календаре.</p>
        )
      ) : (
        <>
          {workshopOptions.length > 1 && (
            <label className="budget-filter">
              <span className="sr-only">Фильтр по цеху</span>
              <select
                data-testid="budget-workshop-filter"
                value={workshopFilter}
                onChange={(event) => setWorkshopFilter(event.target.value)}
              >
                <option value="">Все цеха</option>
                {workshopOptions.map(([workshopId, title]) => (
                  <option key={workshopId} value={workshopId}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
          )}

          {visibleSections.length === 0 ? (
            <p className="empty-state">
              {budget.sections.length === 0 ? 'В смете пока нет разделов.' : 'Нет разделов для выбранного цеха.'}
            </p>
          ) : (
            visibleSections.map((section) => (
              <section key={section.id} className="budget-section" data-testid="budget-section">
                <div className="budget-section__header">
                  <h3>{section.title}</h3>
                  <span className="muted">{section.subtotal} ₽</span>
                </div>
                {isPreliminary ? (
                  <p className="muted budget-section__summary">
                    {section.items.length} {pluralize(section.items.length, 'позиция', 'позиции', 'позиций')}
                  </p>
                ) : (
                  <table className="budget-items-table">
                    <thead>
                      <tr>
                        <th scope="col">
                          <span className="th-label">
                            Описание <SortIcon className="sort-caret" />
                          </span>
                        </th>
                        <th scope="col">Кол-во</th>
                        <th scope="col">Цена</th>
                        <th scope="col">
                          <span className="th-label">
                            Сумма <SortIcon className="sort-caret" />
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.items.map((item) => (
                        <tr key={item.id}>
                          <td>{item.description}</td>
                          <td className="muted">
                            {item.quantity} {item.unit}
                          </td>
                          <td className="muted">{item.unitPrice} ₽</td>
                          <td>{item.total} ₽</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            ))
          )}

          {budget.status === 'APPROVED' && (
            <p className="budget-approved-note">Смета утверждена и больше не редактируется.</p>
          )}
        </>
      )}
    </div>
  );
}
