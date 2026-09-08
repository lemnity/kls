import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppShell } from './app-shell.js';
import { ArrowUpRightIcon, CalendarIcon, DocumentIcon, LayersIcon, MaskIcon, SortIcon } from './icons.js';
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
  const premierePercent = total ? Math.round((withPremiere / total) * 100) : 0;
  const topStatus = distribution[0] ?? null;
  const avgStatusCount = distribution.length ? total / distribution.length : 0;

  return (
    <AppShell>
      <main className="dashboard-main">
        <section className="page-intro">
          <span className="page-intro__badge" aria-hidden="true">
            <MaskIcon />
          </span>
          <div className="page-intro__text">
            <p className="eyebrow">КУЛИСА · ПУЛЬТ ПОСТАНОВКИ</p>
            <h1>{greetingWord()}, Кулиса</h1>
            <p className="muted">{productionCountLabel(total)}</p>
          </div>
        </section>

        <div className="stat-grid">
          <article className="stat-card">
            <div className="stat-card__top">
              <span className="stat-card__icon">
                <MaskIcon />
              </span>
              <span className="stat-card__label">Всего постановок</span>
              <a href="#productions-table" className="view-more">
                Смотреть <ArrowUpRightIcon />
              </a>
            </div>
            <div className="stat-card__figure">
              <strong className="stat-card__value">{total}</strong>
              {withPremiere > 0 && <span className="delta-pill delta-pill--positive">+{withPremiere}</span>}
            </div>
            <ul className="stat-card__legend">
              {distribution.slice(0, 3).map((seg, index) => (
                <li key={seg.status}>
                  <span className="dot" style={{ background: paletteColor(index) }} />
                  <span className="legend-name">{humanize(seg.status)}</span>
                </li>
              ))}
            </ul>
            <div className="stat-card__viz">
              <BubbleViz distribution={distribution} />
            </div>
          </article>

          <article className="stat-card">
            <div className="stat-card__top">
              <span className="stat-card__icon">
                <CalendarIcon />
              </span>
              <span className="stat-card__label">С датой премьеры</span>
              <a href="#productions-table" className="view-more">
                Смотреть <ArrowUpRightIcon />
              </a>
            </div>
            <div className="stat-card__figure">
              <strong className="stat-card__value">{withPremiere}</strong>
              <span className="delta-pill delta-pill--positive">{premierePercent}%</span>
            </div>
            <ul className="stat-card__legend">
              <li>
                <span className="dot" style={{ background: 'var(--color-accent)' }} />
                <span className="legend-name">Дата назначена</span>
              </li>
              <li>
                <span className="dot" style={{ background: 'var(--color-neutral-dot)' }} />
                <span className="legend-name">Ещё не назначена</span>
              </li>
            </ul>
            <div className="stat-card__viz">
              <GaugeViz percent={premierePercent} />
            </div>
          </article>

          <article className="stat-card">
            <div className="stat-card__top">
              <span className="stat-card__icon">
                <DocumentIcon />
              </span>
              <span className="stat-card__label">Без даты премьеры</span>
              <a href="#productions-table" className="view-more">
                Смотреть <ArrowUpRightIcon />
              </a>
            </div>
            <div className="stat-card__figure">
              <strong className="stat-card__value">{withoutPremiere}</strong>
              <span className="delta-pill delta-pill--neutral">{sharePhrase(withoutPremiere, total)}</span>
            </div>
            <ul className="stat-card__legend">
              <li>
                <span className="dot" style={{ background: 'var(--color-accent)' }} />
                <span className="legend-name">С премьерой</span>
              </li>
              <li>
                <span className="dot" style={{ background: 'var(--color-accent-tint-4)' }} />
                <span className="legend-name">Без даты</span>
              </li>
            </ul>
            <div className="stat-card__viz">
              <StackedBarViz withPremiere={withPremiere} withoutPremiere={withoutPremiere} />
            </div>
          </article>

          <article className="stat-card">
            <div className="stat-card__top">
              <span className="stat-card__icon">
                <LayersIcon />
              </span>
              <span className="stat-card__label">Уникальных статусов</span>
              <a href="#productions-table" className="view-more">
                Смотреть <ArrowUpRightIcon />
              </a>
            </div>
            <div className="stat-card__figure">
              <strong className="stat-card__value">{distribution.length}</strong>
              {topStatus && <span className="delta-pill delta-pill--neutral">{Math.round(topStatus.percent)}%</span>}
            </div>
            <ul className="stat-card__legend">
              {distribution.slice(0, 3).map((seg, index) => (
                <li key={seg.status}>
                  <span className="dot" style={{ background: paletteColor(index) }} />
                  <span className="legend-name">{humanize(seg.status)}</span>
                </li>
              ))}
            </ul>
            <div className="stat-card__viz">
              <BarChartViz distribution={distribution} average={avgStatusCount} />
            </div>
          </article>
        </div>

        <div className="lower-grid">
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
                <table className="productions-table table-sortable">
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="sr-only">Здоровье</span>
                      </th>
                      <th scope="col">
                        <span className="th-label">
                          Название <SortIcon className="sort-caret" />
                        </span>
                      </th>
                      <th scope="col">
                        <span className="th-label">
                          Статус <SortIcon className="sort-caret" />
                        </span>
                      </th>
                      <th scope="col">
                        <span className="th-label">
                          Премьера <SortIcon className="sort-caret" />
                        </span>
                      </th>
                      <th scope="col">
                        <span className="sr-only">Действия</span>
                      </th>
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
                          <span className="row-identity">
                            <i className="row-avatar" aria-hidden="true">
                              <MaskIcon />
                            </i>
                            <Link href={`/productions/${production.id}`} className="row-link">
                              {production.title}
                            </Link>
                          </span>
                        </td>
                        <td>
                          <span
                            className="status-pill"
                            data-testid="production-status"
                            data-tone={statusTone(production.status)}
                          >
                            {production.status}
                          </span>
                        </td>
                        <td className="muted">{formatPremiereDate(production.premiereDate)}</td>
                        <td className="cell-actions">
                          <Link
                            href={`/productions/${production.id}`}
                            className="icon-btn"
                            aria-label={`Открыть постановку «${production.title}»`}
                          >
                            <ArrowUpRightIcon />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="card donut-card">
            <div className="donut-card__header">
              <div className="donut-card__header-text">
                <span className="stat-card__icon">
                  <LayersIcon />
                </span>
                <h2>Статусы постановок</h2>
              </div>
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

/**
 * Cosmetic-only display transform for chart labels/legends where space is
 * tight (e.g. "in_progress" -> "in progress"). Never used for the
 * authoritative status-pill text or any data-testid'd content — those keep
 * showing the raw status value.
 */
function humanize(status: string): string {
  return status.replace(/_/g, ' ');
}

/**
 * Loose keyword heuristic mapping a free-text production status to a status
 * pill "tone" (color). Falls back to the default accent tone when nothing
 * matches — this is purely presentational and never changes the underlying
 * status value shown to the user.
 */
function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' | undefined {
  const value = status.toLowerCase();
  if (/(approved|complete|done|premiere|готов|утвержд|выпущ)/.test(value)) return 'success';
  if (/(risk|hold|paus|отмен|cancel|reject)/.test(value)) return 'danger';
  if (/(draft|черновик|planned|план)/.test(value)) return 'neutral';
  return undefined;
}

/* -------------------------------------------------------------------- */
/* Stat card micro-visualizations                                       */
/* -------------------------------------------------------------------- */

function BubbleViz({ distribution }: { distribution: StatusSegment[] }) {
  if (distribution.length === 0) return null;
  const shown = distribution.slice(0, 4);
  const maxCount = shown[0]?.count ?? 1;
  const MIN_SIZE = 34;
  const MAX_SIZE = 84;

  return (
    <div className="bubble-viz">
      {shown.map((segment, index) => {
        const scale = Math.sqrt(segment.count / maxCount);
        const size = Math.round(MIN_SIZE + scale * (MAX_SIZE - MIN_SIZE));
        return (
          <span
            key={segment.status}
            className="bubble"
            style={{ width: size, height: size, background: paletteColor(index) }}
            title={`${humanize(segment.status)} — ${segment.count}`}
          >
            {segment.count}
          </span>
        );
      })}
    </div>
  );
}

function GaugeViz({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const petalCount = 12;
  const achieved = Math.round((clamped / 100) * petalCount);
  const petals = Array.from({ length: petalCount }, (_, index) => {
    const angle = -90 + (index / (petalCount - 1)) * 180;
    return { angle, on: index < achieved };
  });
  const needleAngle = -90 + (clamped / 100) * 180;

  return (
    <div className="gauge-viz">
      <div className="gauge" role="img" aria-label={`${clamped}% постановок с назначенной премьерой`}>
        {petals.map((petal, index) => (
          <span
            key={index}
            className={`gauge-petal${petal.on ? ' gauge-petal--on' : ''}`}
            style={{ transform: `rotate(${petal.angle}deg)` }}
          />
        ))}
        <span className="gauge-needle" style={{ transform: `rotate(${needleAngle}deg)` }} />
      </div>
      <div className="gauge-ticks" aria-hidden="true">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100</span>
      </div>
    </div>
  );
}

function StackedBarViz({ withPremiere, withoutPremiere }: { withPremiere: number; withoutPremiere: number }) {
  const total = withPremiere + withoutPremiere;
  if (total === 0) return null;

  return (
    <div className="stack-viz">
      <div
        className="stack-seg"
        style={{ flex: `${Math.max(withPremiere, 0.0001)} 1 0%`, background: 'var(--color-accent)' }}
      >
        <span className="stack-seg__value" style={{ color: 'var(--color-accent)' }}>
          {withPremiere}
        </span>
      </div>
      <div
        className="stack-seg"
        style={{ flex: `${Math.max(withoutPremiere, 0.0001)} 1 0%`, background: 'var(--color-accent-tint-4)' }}
      >
        <span className="stack-seg__value" style={{ color: 'var(--color-text-soft)' }}>
          {withoutPremiere}
        </span>
      </div>
    </div>
  );
}

function BarChartViz({ distribution, average }: { distribution: StatusSegment[]; average: number }) {
  if (distribution.length === 0) return null;
  const shown = distribution.slice(0, 6);
  const maxCount = shown[0]?.count ?? 1;
  const avgTop = 100 - Math.min(100, (average / maxCount) * 100);

  return (
    <div className="bar-viz">
      <span className="bar-viz__avg" style={{ top: `${avgTop}%` }}>
        <span className="bar-viz__avg-tag">Сред.</span>
      </span>
      {shown.map((segment, index) => {
        const heightPercent = Math.max(10, Math.round((segment.count / maxCount) * 100));
        const active = index === 0;
        return (
          <span key={segment.status} className="bar-viz__col" title={`${humanize(segment.status)} — ${segment.count}`}>
            {active && <span className="bar-viz__callout">{segment.count}</span>}
            <span
              className={`bar-viz__bar${active ? ' bar-viz__bar--active' : ''}`}
              style={{ height: `${heightPercent}%` }}
            />
            <span className="bar-viz__label">{humanize(segment.status)}</span>
          </span>
        );
      })}
    </div>
  );
}
