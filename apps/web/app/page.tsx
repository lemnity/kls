import { redirect } from 'next/navigation';

import { AppShell } from './app-shell.js';
import { CreateProductionButton } from './create-production-button.js';
import {
  ArrowUpRightIcon,
  CalendarIcon,
  ClipboardIcon,
  DocumentIcon,
  LayersIcon,
  MaskIcon,
  MessageIcon,
} from './icons.js';
import { apiFetch } from './lib/api.js';
import { formatPremiereDate, humanizeStatus, pluralize } from './lib/format.js';
import { MOCK_MEMBERSHIPS, MOCK_PRODUCTIONS, type Membership, type Production, type WorkshopTask } from './lib/mock-data.js';
import { getSessionToken } from './lib/session.js';
import { PremiereCountdownCard } from './premiere-countdown-card.js';
import { ProductionsTable } from './productions-table.js';

interface TodayTask {
  id: string;
  description: string;
  productionTitle: string;
  workshopName: string;
  status: string;
}

const TASK_STATUS_LABEL: Record<string, string> = {
  new: 'Новая',
  assigned: 'Назначена',
  accepted: 'Принята',
  completed: 'Выполнена',
  closed: 'Закрыта',
};

export default async function HomePage() {
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const [productions, memberships] = await Promise.all([loadProductions(token), loadMemberships(token)]);
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
  const todaysTasks = await loadTodaysTasks(productions, token);

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
          <CreateProductionButton memberships={memberships} />
        </section>

        <div className="quick-cards">
          <article className="card messenger-card">
            <div className="table-card__header">
              <div className="donut-card__header-text">
                <span className="stat-card__icon">
                  <MessageIcon />
                </span>
                <h2>Мессенджер</h2>
              </div>
              <span className="tab tab--soon" aria-disabled="true">
                скоро
              </span>
            </div>
            {memberships.length === 0 ? (
              <p className="empty-state">В тенанте пока нет участников.</p>
            ) : (
              <ul className="messenger-list">
                {memberships.slice(0, 5).map((membership) => (
                  <li key={membership.id} className="messenger-row">
                    <span className="messenger-avatar" aria-hidden="true">
                      {membership.userEmail.charAt(0).toUpperCase()}
                    </span>
                    <span className="messenger-name">{membership.userEmail}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted messenger-note">
              Обмен сообщениями ещё не подключён — пока здесь список участников тенанта.
            </p>
          </article>

          <article className="card">
            <div className="table-card__header">
              <div className="donut-card__header-text">
                <span className="stat-card__icon">
                  <ClipboardIcon />
                </span>
                <h2>Задачи на сегодня</h2>
              </div>
              <span className="muted">{todaysTasks.length}</span>
            </div>
            {todaysTasks.length === 0 ? (
              <p className="empty-state">На сегодня задач со сроком нет.</p>
            ) : (
              <ul className="today-tasks-list">
                {todaysTasks.slice(0, 5).map((task) => (
                  <li key={task.id} className="today-tasks-row">
                    <span className={`status-pill status-pill--${task.status}`}>
                      {TASK_STATUS_LABEL[task.status] ?? task.status}
                    </span>
                    <span className="today-tasks-row__body">
                      <span className="today-tasks-row__title">{task.description}</span>
                      <span className="muted today-tasks-row__meta">
                        {task.productionTitle} · {task.workshopName}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>

          {premiereHighlight ? (
            <PremiereCountdownCard
              label={premiereHighlight.label}
              productionId={premiereHighlight.production.id}
              productionTitle={premiereHighlight.production.title}
              premiereDate={premiereHighlight.production.premiereDate as string}
            />
          ) : (
            <article className="card premiere-countdown premiere-countdown--empty">
              <div className="premiere-countdown__header">
                <span className="premiere-countdown__icon" aria-hidden="true">
                  <CalendarIcon />
                </span>
                <span className="premiere-countdown__label">Премьера</span>
              </div>
              <p className="muted">Даты премьер пока не назначены ни у одной постановки.</p>
            </article>
          )}
        </div>

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
                  <span className="legend-name">{humanizeStatus(seg.status)}</span>
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
                  <span className="legend-name">{humanizeStatus(seg.status)}</span>
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

            <ProductionsTable productions={productions} />
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

            <div className={`donut-card__footer${premiereHighlight ? ' donut-card__footer--spotlight' : ''}`}>
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

async function loadMemberships(token: string): Promise<Membership[]> {
  if (process.env.E2E_MOCK_PRODUCTIONS === '1') {
    return MOCK_MEMBERSHIPS;
  }

  const response = await apiFetch('/v1/organization/memberships', { token });
  if (!response.ok) return [];

  return (await response.json()) as Membership[];
}

/**
 * Tasks (classic, single-assignee) across every production whose deadline
 * falls on today — there's no single "all tasks in the tenant" endpoint, so
 * this fans out one request per production and filters client-side. Fine
 * at demo-tenant scale; would need a real aggregation endpoint before this
 * stops being fine.
 */
async function loadTodaysTasks(productions: Production[], token: string): Promise<TodayTask[]> {
  if (process.env.E2E_MOCK_PRODUCTIONS === '1' || productions.length === 0) {
    return [];
  }

  const workshopNameById = await loadWorkshopNames(token);
  const todayDateOnly = new Date().toISOString().slice(0, 10);

  const perProduction = await Promise.all(
    productions.map(async (production) => {
      const response = await apiFetch(`/v1/productions/${production.id}/workshop-tasks`, { token });
      if (!response.ok) return [];
      const tasks = (await response.json()) as WorkshopTask[];
      return tasks
        .filter((task) => task.deadlineAt?.slice(0, 10) === todayDateOnly)
        .map(
          (task): TodayTask => ({
            id: task.id,
            description: task.description,
            productionTitle: production.title,
            workshopName: workshopNameById.get(task.workshopId) ?? 'Цех',
            status: task.status,
          }),
        );
    }),
  );

  return perProduction.flat();
}

async function loadWorkshopNames(token: string): Promise<Map<string, string>> {
  const response = await apiFetch('/v1/organization/workshops', { token });
  if (!response.ok) return new Map();

  const workshops = (await response.json()) as { id: string; name: string }[];
  return new Map(workshops.map((workshop) => [workshop.id, workshop.name]));
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
            title={`${humanizeStatus(segment.status)} — ${segment.count}`}
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
          <span key={segment.status} className="bar-viz__col" title={`${humanizeStatus(segment.status)} — ${segment.count}`}>
            {active && <span className="bar-viz__callout">{segment.count}</span>}
            <span
              className={`bar-viz__bar${active ? ' bar-viz__bar--active' : ''}`}
              style={{ height: `${heightPercent}%` }}
            />
            <span className="bar-viz__label">{humanizeStatus(segment.status)}</span>
          </span>
        );
      })}
    </div>
  );
}
