'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { LayersIcon, SearchIcon } from '../icons.js';

interface Workshop {
  id: string;
  name: string;
  isActive: boolean;
}

export function WorkshopsGrid({ workshops }: { workshops: Workshop[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return workshops;
    return workshops.filter((workshop) => workshop.name.toLowerCase().includes(needle));
  }, [workshops, query]);

  return (
    <>
      {workshops.length > 4 && (
        <label className="table-search">
          <SearchIcon className="table-search__icon" />
          <span className="sr-only">Поиск по цехам</span>
          <input
            type="search"
            placeholder="Найти цех по названию…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}

      {filtered.length === 0 ? (
        <p className="empty-state">Ничего не найдено — измените запрос.</p>
      ) : (
        <div className="cards" data-testid="workshops-list">
          {filtered.map((workshop) => (
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
    </>
  );
}
