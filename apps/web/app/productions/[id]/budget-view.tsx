'use client';

import { useEffect, useMemo, useState } from 'react';

import { SortIcon } from '../../icons.js';
import { pluralize } from '../../lib/format.js';
import type { Budget, WorkshopTask } from '../../lib/mock-data.js';

const BUDGET_STATUS_LABEL: Record<string, string> = {
  PRELIMINARY: 'Предварительная',
  DETAILED: 'Подробная',
  APPROVED: 'Утверждённая',
};

const CALENDAR_DAY_COUNT = 100;
const DONE_STATUSES = new Set(['completed', 'closed']);

const CLASSIC_TASK_STATUS_LABEL: Record<string, string> = {
  new: 'Новая',
  assigned: 'Назначена',
  accepted: 'Принята',
  completed: 'Выполнена',
  closed: 'Закрыта',
};

type DayCellStatus = 'done' | 'overdue' | 'in-progress' | null;

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
  if (tasksForDay.every((task) => DONE_STATUSES.has(task.status))) return 'done';
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

const STEP_ORDER = ['new', 'assigned', 'accepted', 'completed', 'closed'] as const;

interface CreateWorkshopTaskInput {
  workshopId: string;
  description: string;
  startAt: string;
  deadlineAt: string;
  assigneeMembershipId?: string;
}

type MembershipOption = { id: string; userEmail: string; status: string };

/**
 * A single task's lifecycle as a vertical stepper — visual style requested
 * by the user via a reference screenshot of a document e-signing flow.
 * Steps map 1:1 onto WorkshopTask's real status sequence (new → assigned →
 * accepted → completed → closed) and the one action shown per step calls
 * the same REST endpoints already used by workshops/[id]/task-board.tsx
 * (assign/accept/complete/close), so no new backend surface was needed for
 * this part.
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

  const currentIndex = STEP_ORDER.indexOf(task.status as (typeof STEP_ORDER)[number]);
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
    } catch {
      setError('Сеть недоступна. Попробуйте ещё раз.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="task-stepper">
      {STEP_ORDER.map((step, index) => {
        const state = currentIndex < 0 ? 'pending' : index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'pending';
        return (
          <div key={step} className={`task-stepper__step task-stepper__step--${state}`}>
            <span className="task-stepper__rail" aria-hidden="true">
              <span className="task-stepper__dot" />
              {index < STEP_ORDER.length - 1 && <span className="task-stepper__line" />}
            </span>
            <div className="task-stepper__content">
              <p className="task-stepper__state">
                {state === 'done' ? 'Выполнено' : state === 'current' ? 'Текущий этап' : 'Ожидает'}
              </p>
              <p className="task-stepper__label">{CLASSIC_TASK_STATUS_LABEL[step]}</p>

              {step !== 'new' && assignee && (
                <div className="task-stepper__person">
                  <span className="task-stepper__avatar" aria-hidden="true">
                    {assignee.userEmail.charAt(0).toUpperCase()}
                  </span>
                  <span>{assignee.userEmail}</span>
                </div>
              )}

              {state === 'current' && step === 'new' && (
                <form
                  className="task-stepper__action"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (assigneeChoice) {
                      void runAction(`workshop-tasks/${task.id}/assign`, 'PATCH', {
                        assigneeMembershipId: assigneeChoice,
                      });
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
              {state === 'current' && step === 'assigned' && (
                <button
                  type="button"
                  className="btn-pill btn-pill--accent btn-pill--small"
                  disabled={pending}
                  onClick={() => void runAction(`workshop-tasks/${task.id}/accept`, 'POST')}
                >
                  Принять
                </button>
              )}
              {state === 'current' && step === 'accepted' && (
                <button
                  type="button"
                  className="btn-pill btn-pill--accent btn-pill--small"
                  disabled={pending}
                  onClick={() => void runAction(`workshop-tasks/${task.id}/complete`, 'POST')}
                >
                  Выполнено
                </button>
              )}
              {state === 'current' && step === 'completed' && (
                <button
                  type="button"
                  className="btn-pill btn-pill--accent btn-pill--small"
                  disabled={pending}
                  onClick={() => void runAction(`workshop-tasks/${task.id}/close`, 'POST')}
                >
                  Закрыть
                </button>
              )}
            </div>
          </div>
        );
      })}
      {error && (
        <p role="alert" className="task-row__error">
          {error}
        </p>
      )}
    </div>
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

  const [allWorkshops, setAllWorkshops] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [extraWorkshops, setExtraWorkshops] = useState<[string, string][]>([]);
  const [addingDepartment, setAddingDepartment] = useState(false);
  const [pickedWorkshopId, setPickedWorkshopId] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [selected, setSelected] = useState<{ workshopId: string; title: string; day: string } | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [allMemberships, setAllMemberships] = useState<MembershipOption[]>([]);
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState('');
  const [newTaskStartAt, setNewTaskStartAt] = useState('');
  const [newTaskEndAt, setNewTaskEndAt] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [createTaskError, setCreateTaskError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/proxy/organization/workshops')
      .then((response) => (response.ok ? (response.json() as Promise<{ id: string; name: string; isActive: boolean }[]>) : []))
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
  const filteredRows = useMemo(
    () => rows.filter(([, title]) => title.toLowerCase().includes(departmentFilter.trim().toLowerCase())),
    [rows, departmentFilter],
  );

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

          {filteredRows.length === 0 ? (
            <p className="empty-state">Ничего не найдено — измените поиск.</p>
          ) : (
            filteredRows.map(([workshopId, title]) => {
              const byDay = tasksByWorkshopAndDay.get(workshopId);
              return (
                <div key={workshopId} className="budget-gantt__row">
                  <span className="budget-gantt__row-label">{title}</span>
                  <div className="budget-gantt__cells">
                    {days.map((day) => {
                      const status = dayCellStatus(byDay?.get(day) ?? [], day, today);
                      const isSelected = selected?.workshopId === workshopId && selected.day === day;
                      return (
                        <button
                          key={day}
                          type="button"
                          className={`budget-gantt__cell${status ? ` budget-gantt__cell--${status}` : ''}${isSelected ? ' budget-gantt__cell--selected' : ''}${isWeekend(day) ? ' budget-gantt__cell--weekend' : ''}`}
                          title={`${title}, ${formatDayLabel(day)}`}
                          onClick={() => openCell(workshopId, title, day)}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {selected && (
        <div className="task-modal-backdrop" onClick={closeModal}>
          <div
            className="task-modal"
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
                              <span className="muted">{CLASSIC_TASK_STATUS_LABEL[task.status] ?? task.status}</span>
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
      <div className="budget-toolbar">
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
