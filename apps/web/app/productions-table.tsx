'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { ArrowUpRightIcon, MaskIcon, SearchIcon, SortIcon } from './icons.js';
import { formatPremiereDate, healthLabel, productionStatusTone } from './lib/format.js';
import type { Production } from './lib/mock-data.js';

type SortKey = 'title' | 'status' | 'premiereDate';
type SortDirection = 'asc' | 'desc';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Название' },
  { key: 'status', label: 'Статус' },
  { key: 'premiereDate', label: 'Премьера' },
];

function compareValues(a: Production, b: Production, key: SortKey): number {
  if (key === 'premiereDate') {
    // Missing premiere dates sort last regardless of direction — an
    // undecided date isn't "smaller" than a real one, it's unranked.
    if (a.premiereDate === b.premiereDate) return 0;
    if (a.premiereDate === null) return 1;
    if (b.premiereDate === null) return -1;
    return a.premiereDate.localeCompare(b.premiereDate);
  }
  return a[key].localeCompare(b[key], 'ru');
}

export function ProductionsTable({ productions }: { productions: Production[] }) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return productions;
    return productions.filter(
      (production) =>
        production.title.toLowerCase().includes(needle) || production.status.toLowerCase().includes(needle),
    );
  }, [productions, query]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const rows = [...filtered].sort((a, b) => compareValues(a, b, sortKey));
    return sortDirection === 'asc' ? rows : rows.reverse();
  }, [filtered, sortKey, sortDirection]);

  function toggleSort(key: SortKey): void {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDirection('asc');
      return;
    }
    if (sortDirection === 'asc') {
      setSortDirection('desc');
      return;
    }
    // Third click resets to the server's own order rather than forcing the
    // user to guess which direction "unsorted" looks like.
    setSortKey(null);
  }

  return (
    <>
      <label className="table-search">
        <SearchIcon className="table-search__icon" />
        <span className="sr-only">Поиск по постановкам</span>
        <input
          type="search"
          placeholder="Найти постановку по названию или статусу…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-testid="productions-search"
        />
      </label>

      {sorted.length === 0 ? (
        <p data-testid="productions-empty" className="empty-state">
          {productions.length === 0 ? 'Постановок пока нет.' : 'Ничего не найдено — измените запрос.'}
        </p>
      ) : (
        <div className="table-scroll" data-testid="productions-list">
          <table className="productions-table table-sortable">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Здоровье</span>
                </th>
                {COLUMNS.map((column) => (
                  <th key={column.key} scope="col" aria-sort={sortAriaValue(sortKey, sortDirection, column.key)}>
                    <button type="button" className="th-label th-label--button" onClick={() => toggleSort(column.key)}>
                      {column.label}
                      <SortIcon
                        className={[
                          'sort-caret',
                          sortKey === column.key && 'sort-caret--active',
                          sortKey === column.key && sortDirection === 'desc' && 'sort-caret--desc',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      />
                    </button>
                  </th>
                ))}
                <th scope="col">
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((production) => (
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
                      data-tone={productionStatusTone(production.status)}
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
    </>
  );
}

function sortAriaValue(
  activeKey: SortKey | null,
  direction: SortDirection,
  key: SortKey,
): 'ascending' | 'descending' | 'none' {
  if (activeKey !== key) return 'none';
  return direction === 'asc' ? 'ascending' : 'descending';
}
