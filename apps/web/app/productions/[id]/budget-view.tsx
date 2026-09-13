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

function BudgetCalendarBoard({
  workshops,
  tasks,
  startDate,
}: {
  workshops: [string, string][];
  tasks: WorkshopTask[];
  startDate: string;
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
      const day = toDateOnly(task.deadlineAt);
      const byDay = map.get(task.workshopId) ?? new Map<string, WorkshopTask[]>();
      const dayTasks = byDay.get(day) ?? [];
      dayTasks.push(task);
      byDay.set(day, dayTasks);
      map.set(task.workshopId, byDay);
    }
    return map;
  }, [tasks]);

  const [allWorkshops, setAllWorkshops] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [extraWorkshops, setExtraWorkshops] = useState<[string, string][]>([]);
  const [addingDepartment, setAddingDepartment] = useState(false);
  const [pickedWorkshopId, setPickedWorkshopId] = useState('');
  const [selected, setSelected] = useState<{ workshopId: string; title: string; day: string } | null>(null);

  useEffect(() => {
    fetch('/api/proxy/organization/workshops')
      .then((response) => (response.ok ? (response.json() as Promise<{ id: string; name: string; isActive: boolean }[]>) : []))
      .then(setAllWorkshops)
      .catch(() => setAllWorkshops([]));
  }, []);

  const rows = useMemo(() => [...workshops, ...extraWorkshops], [workshops, extraWorkshops]);
  const availableToAdd = useMemo(
    () => allWorkshops.filter((workshop) => workshop.isActive && !rows.some(([id]) => id === workshop.id)),
    [allWorkshops, rows],
  );

  function handleAddDepartment(): void {
    const workshop = allWorkshops.find((item) => item.id === pickedWorkshopId);
    if (!workshop) return;
    setExtraWorkshops((current) => [...current, [workshop.id, workshop.name]]);
    setPickedWorkshopId('');
    setAddingDepartment(false);
  }

  const selectedTasks = selected ? tasksByWorkshopAndDay.get(selected.workshopId)?.get(selected.day) ?? [] : [];

  return (
    <section className="budget-gantt" aria-label="Календарь задач по дням">
      <div className="budget-gantt__header">
        <div>
          <h3>Календарь</h3>
          <p className="muted budget-gantt__hint">
            {CALENDAR_DAY_COUNT} дней от {formatDayLabel(startDate)} — зелёный: все задачи дня выполнены, жёлтый: в
            работе, красный: просрочены. Клик по ячейке показывает задачи дня.
          </p>
        </div>
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
          {rows.map(([workshopId, title]) => {
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
                        className={`budget-gantt__cell${status ? ` budget-gantt__cell--${status}` : ''}${isSelected ? ' budget-gantt__cell--selected' : ''}`}
                        title={`${title}, ${formatDayLabel(day)}`}
                        onClick={() => setSelected({ workshopId, title, day })}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selected && (
        <div className="budget-gantt__detail">
          <div className="budget-gantt__detail-header">
            <strong>
              {selected.title}, {formatDayLabel(selected.day)}
            </strong>
            <button
              type="button"
              className="icon-btn icon-btn--ghost"
              aria-label="Закрыть"
              onClick={() => setSelected(null)}
            >
              ✕
            </button>
          </div>
          {selectedTasks.length === 0 ? (
            <p className="muted">Задач на этот день нет.</p>
          ) : (
            <ul className="budget-gantt__detail-list">
              {selectedTasks.map((task) => (
                <li key={task.id}>
                  <span>{task.description}</span>
                  <span className="muted">{CLASSIC_TASK_STATUS_LABEL[task.status] ?? task.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

type ViewTab = 'items' | 'calendar';

export function BudgetView({ budget, workshopTasks }: { budget: Budget; workshopTasks: WorkshopTask[] }) {
  const [workshopFilter, setWorkshopFilter] = useState('');
  const [activeTab, setActiveTab] = useState<ViewTab>('items');

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

      {activeTab === 'calendar' ? (
        workshopOptions.length > 0 ? (
          <BudgetCalendarBoard workshops={workshopOptions} tasks={workshopTasks} startDate={toDateOnly(budget.createdAt)} />
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
