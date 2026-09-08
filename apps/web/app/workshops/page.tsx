import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppShell } from '../app-shell.js';
import { LayersIcon } from '../icons.js';
import { apiFetch } from '../lib/api.js';
import { getSessionToken } from '../lib/session.js';

interface Workshop {
  id: string;
  name: string;
  isActive: boolean;
}

type LoadResult<T> = T | 'forbidden' | 'unavailable';

export default async function WorkshopsPage() {
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const workshops = await loadWorkshops(token);
  if (workshops === 'forbidden') {
    return (
      <main className="shell-message">
        <div className="message-card">
          <p role="alert">Недостаточно прав для просмотра цехов.</p>
        </div>
      </main>
    );
  }
  if (workshops === 'unavailable') {
    return (
      <main className="shell-message">
        <div className="message-card">
          <p role="alert">Не удалось загрузить цеха. Попробуйте позже.</p>
        </div>
      </main>
    );
  }

  return (
    <AppShell active="workshops">
      <main className="dashboard-main">
        <section className="page-intro">
          <p className="eyebrow">ЦЕХА</p>
          <h1>Рабочая очередь</h1>
          <p className="muted">
            {workshops.length === 0 ? 'Цехов пока нет.' : `${workshops.length} цех(ов) в тенанте`}
          </p>
        </section>

        {workshops.length === 0 ? (
          <p className="empty-state">Цеха создаются через API — UI создания появится позже.</p>
        ) : (
          <div className="cards" data-testid="workshops-list">
            {workshops.map((workshop) => (
              <Link key={workshop.id} href={`/workshops/${workshop.id}`} className="card workshop-card">
                <i className="stat-card__icon" aria-hidden="true">
                  <LayersIcon />
                </i>
                <h2>{workshop.name}</h2>
                <span className={workshop.isActive ? 'status-pill' : 'status-pill status-pill--muted'}>
                  {workshop.isActive ? 'Активен' : 'Неактивен'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}

async function loadWorkshops(token: string): Promise<Workshop[] | 'forbidden' | 'unavailable'> {
  const response = await apiFetch('/v1/organization/workshops', { token });
  if (response.status === 401) redirect('/login');
  if (response.status === 403) return 'forbidden';
  if (!response.ok) return 'unavailable';

  return (await response.json()) as Workshop[];
}
