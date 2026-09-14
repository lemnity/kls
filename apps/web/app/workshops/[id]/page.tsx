import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppShell } from '../../app-shell.js';
import { ArrowLeftIcon, ClipboardIcon, LayersIcon } from '../../icons.js';
import { apiFetch } from '../../lib/api.js';
import { getSessionToken } from '../../lib/session.js';
import { CreateDepartmentButton } from './create-department-button.js';
import { TaskBoard } from './task-board.js';

interface TaskStage {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'done';
  sortOrder: string;
  startedAt: string | null;
  completedAt: string | null;
}

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
  rejectedAt: string | null;
  stages: TaskStage[];
}

interface MembershipOption {
  id: string;
  userEmail: string;
  status: string;
}

interface WorkshopOption {
  id: string;
  name: string;
  isActive: boolean;
  parentWorkshopId: string | null;
}

export default async function WorkshopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const [tasks, memberships, workshops, currentMembershipId] = await Promise.all([
    loadTasks(id, token),
    loadMemberships(token),
    loadWorkshops(token),
    loadCurrentMembershipId(token),
  ]);
  if (tasks === 'unavailable' || memberships === 'unavailable' || workshops === 'unavailable') {
    return (
      <main className="shell-message">
        <div className="message-card">
          <p role="alert">Не удалось загрузить цех. Попробуйте позже.</p>
        </div>
      </main>
    );
  }

  const currentWorkshop = workshops.find((workshop) => workshop.id === id);
  if (!currentWorkshop) {
    return (
      <main className="shell-message">
        <div className="message-card">
          <p role="alert">Цех не найден.</p>
        </div>
      </main>
    );
  }
  const departments = workshops.filter((workshop) => workshop.parentWorkshopId === id);

  return (
    <AppShell active="workshops">
      <main className="dashboard-main">
        <section className="page-intro">
          <Link href="/workshops" className="icon-btn icon-btn--ghost page-intro__back" aria-label="К цехам" title="К цехам">
            <ArrowLeftIcon />
          </Link>
          <p className="eyebrow">ЦЕХ · РАБОЧАЯ ОЧЕРЕДЬ</p>
          <h1>{currentWorkshop.name}</h1>
          <p className="muted">{tasks.length === 0 ? 'Задач пока нет' : `${tasks.length} задач(и)`}</p>
        </section>

        <article className="card">
          <div className="table-card__header">
            <div className="donut-card__header-text">
              <span className="stat-card__icon">
                <LayersIcon />
              </span>
              <h2>Отделы</h2>
            </div>
            <CreateDepartmentButton parentWorkshopId={id} memberships={memberships} />
          </div>
          {departments.length === 0 ? (
            <p className="empty-state">У этого цеха пока нет отделов.</p>
          ) : (
            <div className="cards">
              {departments.map((department) => (
                <Link key={department.id} href={`/workshops/${department.id}`} className="card workshop-card">
                  <i className="stat-card__icon" aria-hidden="true">
                    <LayersIcon />
                  </i>
                  <h2>{department.name}</h2>
                  <span className={department.isActive ? 'status-pill' : 'status-pill status-pill--muted'}>
                    {department.isActive ? 'Активен' : 'Неактивен'}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <div className="table-card__header">
            <div className="donut-card__header-text">
              <span className="stat-card__icon">
                <ClipboardIcon />
              </span>
              <h2>Очередь задач</h2>
            </div>
          </div>
          <TaskBoard initialTasks={tasks} memberships={memberships} currentMembershipId={currentMembershipId} />
        </article>
      </main>
    </AppShell>
  );
}

async function loadTasks(workshopId: string, token: string): Promise<Task[] | 'unavailable'> {
  const response = await apiFetch(`/v1/organization/workshops/${workshopId}/tasks`, { token });
  if (response.status === 401) redirect('/login');
  if (!response.ok) return 'unavailable';

  return (await response.json()) as Task[];
}

async function loadMemberships(token: string): Promise<MembershipOption[] | 'unavailable'> {
  const response = await apiFetch('/v1/organization/memberships', { token });
  if (response.status === 401) redirect('/login');
  if (!response.ok) return 'unavailable';

  return (await response.json()) as MembershipOption[];
}

async function loadWorkshops(token: string): Promise<WorkshopOption[] | 'unavailable'> {
  const response = await apiFetch('/v1/organization/workshops', { token });
  if (response.status === 401) redirect('/login');
  if (!response.ok) return 'unavailable';

  return (await response.json()) as WorkshopOption[];
}

async function loadCurrentMembershipId(token: string): Promise<string | null> {
  const response = await apiFetch('/v1/session', { token });
  if (!response.ok) return null;

  const session = (await response.json()) as { membershipId: string };
  return session.membershipId;
}
