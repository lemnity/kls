import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppShell } from './app-shell.js';
import { CalendarIcon, DocumentIcon, LayersIcon, MaskIcon } from './icons.js';
import { apiFetch } from './lib/api.js';
import { formatPremiereDate, healthLabel, pluralize } from './lib/format.js';
import { MOCK_PRODUCTIONS, type Production } from './lib/mock-data.js';
import { getSessionToken } from './lib/session.js';

export default async function HomePage() {
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const productions = await loadProductions(token);
  if (productions === 'forbidden') {
    return (
      <main className="shell-message">
        <div className="message-card">
          <p role="alert">Недостаточно прав для просмотра постановок.</p>
        </div>
      </main>
    );
  }
  if (productions === 'unavailable') {
    return (
      <main className="shell-message">
        <div className="message-card">
          <p role="alert">Не удалось загрузить постановки. Попробуйте позже.</p>
        </div>
      </main>
    );
  }

  const total = productions.length;
  const withPremiere = productions.filter((p) => p.premiereDate !== null).length;
  const withoutPremiere = total - withPremiere;
  const distribution = computeDistribution(productions);
  const premiereHighlight = getPremiereHighlight(productions);

  return (
    <AppShell>
      <main className="dashboard-main">
        <section className="page-intro">
          <p className="eyebrow">КУЛИСА · ПУЛЬТ ПОСТАНОВКИ</p>
          <h1>{greetingWord()}, Кулиса</h1>
          <p className="muted">{productionCountLabel(total)}</p>
        </section>

        <div className="top-grid">
          <div className="stat-grid">
            <article className="stat-card stat-card--accent">
              <div className="stat-card__top">
                <span className="stat-card__label">Всего постановок</span>
                <span className="stat-card__icon">
                  <MaskIcon />
                </span>
              </div>
              <strong className="stat-card__value">{total}</strong>
              <span className="stat-card__hint">во всех статусах</span>
            </article>

            <article className="stat-card">
              <div className="stat-card__top">
                <span className="stat-card__label">С датой премьеры</span>
                <span className="stat-card__icon">
                  <CalendarIcon />
                </span>
              </div>
              <strong className="stat-card__value">{withPremiere}</strong>
              <span className="stat-card__hint">{sharePhrase(withPremiere, total)}</span>
            </article>

            <article className="stat-card">
              <div className="stat-card__top">
                <span className="stat-card__label">Без даты премьеры</span>
                <span className="stat-card__icon">
                  <DocumentIcon />
                </span>
              </div>
              <strong className="stat-card__value">{withoutPremiere}</strong>
              <span className="stat-card__hint">{sharePhrase(withoutPremiere, total)}</span>
            </article>

            <article className="stat-card">
              <div className="stat-card__top">
                <span className="stat-card__label">Уникальных статусов</span>
                <span className="stat-card__icon">
                  <LayersIcon />
                </span>
              </div>
              <strong className="stat-card__value">{distribution.length}</strong>
              <span className="stat-card__hint">в текущей работе</span>
            </article>
          </div>

          <article className="card donut-card">
            <div className="donut-card__header">
              <h2>Статусы постановок</h2>
              <a href="#productions-table" className="details-link">
                К списку
              </a>
            </div>

            {distribution.length === 0 ? (
              <p className="muted">Пока нет данных для распределения.</p>
            ) : (
              <>
                <div
                  className="donut"
                  style={{ backgroundImage: conicGradient(distribution, total) }}
                  role="img"
                  aria-label={donutAriaLabel(distribution, total)}
                >
                  <div className="donut__hole">
                    <strong>{Math.round(distribution[0]?.percent ?? 0)}%</strong>
                    <span>статус «{distribution[0]?.status ?? ''}»</span>
                  </div>
                </div>
                <ul className="donut-legend">
                  {distribution.map((seg, index) => (
                    <li key={seg.status}>
                      <i className="legend-swatch" style={{ background: paletteColor(index) }} />
                      <span className="legend-status">{seg.status}</span>
                      <span className="legend-count">{seg.count}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="donut-card__footer">
              <span className="muted">{premiereHighlight?.label ?? 'Премьера'}</span>
              {premiereHighlight ? (
                <p>
                  <strong>{premiereHighlight.production.title}</strong> ·{' '}
                  {formatPremiereDate(premiereHighlight.production.premiereDate)}
                </p>
              ) : (
                <p>Премьеры пока не запланированы</p>
              )}
            </div>
          </article>
        </div>

        <article className="card table-card" id="productions-table">
          <div className="table-card__header">
            <h2>Постановки</h2>
            <p className="muted">{productionCountLabel(total)}</p>
          </div>

          {productions.length === 0 ? (
            <p data-testid="productions-empty" className="empty-state">
              Постановок пока нет.
            </p>
          ) : (
            <div className="table-scroll" data-testid="productions-list">
              <table className="productions-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Здоровье</span>
                    </th>
                    <th scope="col">Название</th>
                    <th scope="col">Статус</th>
                    <th scope="col">Премьера</th>
                  </tr>
                </thead>
                <tbody>
                  {productions.map((production) => (
                    <tr key={production.id} data-testid="production-card">
                      <td className="cell-health">
                        <i
                          className="health-dot"
                          data-testid="production-health"
                          data-health={production.healthStatus}
                          title={healthLabel(production.healthStatus)}
                        />
                        <span className="sr-only">{healthLabel(production.healthStatus)}</span>
                      </td>
                      <td className="cell-title">
                        <Link href={`/productions/${production.id}`} className="row-link">
                          {production.title}
                        </Link>
                      </td>
                      <td>
                        <span className="status-pill" data-testid="production-status">
                          {production.status}
                        </span>
                      </td>
                      <td className="muted">{formatPremiereDate(production.premiereDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </main>
    </AppShell>
  );
}

async function loadProductions(token: string): Promise<Production[] | 'forbidden' | 'unavailable'> {
  if (process.env.E2E_MOCK_PRODUCTIONS === '1') {
    return MOCK_PRODUCTIONS;
  }

  const response = await apiFetch('/v1/productions', { token });
  if (response.status === 401) redirect('/login');
  if (response.status === 403) return 'forbidden';
  if (!response.ok) return 'unavailable';

  return (await response.json()) as Production[];
}

function productionCountLabel(count: number): string {
  if (count === 0) return 'Постановок в работе нет';
  return `${count} ${pluralize(count, 'постановка', 'постановки', 'постановок')} в работе`;
}

function sharePhrase(count: number, total: number): string {
  if (total === 0) return 'нет постановок';
  const percent = Math.round((count / total) * 100);
  return `${percent}% от всех`;
}

function greetingWord(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 18) return 'Добрый день';
  if (hour >= 18 && hour < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

interface StatusSegment {
  status: string;
  count: number;
  percent: number;
}

function computeDistribution(productions: Production[]): StatusSegment[] {
  const total = productions.length;
  const counts = new Map<string, number>();
  for (const production of productions) {
    counts.set(production.status, (counts.get(production.status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, count]) => ({ status, count, percent: total ? (count / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);
}

const STATUS_PALETTE = ['#4338ca', '#4f46e5', '#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe'];

function paletteColor(index: number): string {
  return STATUS_PALETTE[index % STATUS_PALETTE.length] ?? '#4338ca';
}

function conicGradient(distribution: StatusSegment[], total: number): string {
  let cumulative = 0;
  const stops = distribution.map((segment, index) => {
    const start = cumulative;
    const width = total ? (segment.count / total) * 100 : 0;
    cumulative += width;
    return `${paletteColor(index)} ${start}% ${cumulative}%`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

function donutAriaLabel(distribution: StatusSegment[], total: number): string {
  const parts = distribution.map((segment) => `${segment.status} — ${segment.count}`).join(', ');
  return `Распределение ${total} ${pluralize(total, 'постановки', 'постановок', 'постановок')} по статусам: ${parts}`;
}

interface PremiereHighlight {
  label: string;
  production: Production;
}

function getPremiereHighlight(productions: Production[]): PremiereHighlight | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dated = productions
    .filter((production): production is Production & { premiereDate: string } => production.premiereDate !== null)
    .map((production) => ({ production, date: new Date(production.premiereDate) }))
    .filter((entry) => !Number.isNaN(entry.date.getTime()));

  if (dated.length === 0) return null;

  const upcoming = dated
    .filter((entry) => entry.date.getTime() >= today.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const soonest = upcoming[0];
  if (soonest) {
    return { label: 'Ближайшая премьера', production: soonest.production };
  }

  const past = [...dated].sort((a, b) => b.date.getTime() - a.date.getTime())[0];
  if (!past) return null;
  return { label: 'Последняя премьера', production: past.production };
}
