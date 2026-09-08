import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppShell } from '../../app-shell.js';
import { apiFetch } from '../../lib/api.js';
import { getSessionToken } from '../../lib/session.js';
import { TaskBoard } from './task-board.js';

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

export default async function WorkshopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const [tasks, memberships] = await Promise.all([loadTasks(id, token), loadMemberships(token)]);
  if (tasks === 'unavailable' || memberships === 'unavailable') {
    return (
      <main className="shell-message">
        <div className="message-card">
          <p role="alert">Не удалось загрузить цех. Попробуйте позже.</p>
        </div>
      </main>
    );
  }

  return (
    <AppShell active="workshops">
      <main className="dashboard-main">
        <p className="breadcrumb">
          <Link href="/workshops" className="row-link">
            ← К цехам
          </Link>
        </p>

        <section className="page-intro">
          <p className="eyebrow">ЦЕХ · РАБОЧАЯ ОЧЕРЕДЬ</p>
          <h1>Задачи</h1>
          <p className="muted">{tasks.length === 0 ? 'Задач пока нет' : `${tasks.length} задач(и)`}</p>
        </section>

        <article className="card">
          <TaskBoard initialTasks={tasks} memberships={memberships} />
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
