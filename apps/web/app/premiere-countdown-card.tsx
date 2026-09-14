'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { CalendarIcon, TimerIcon } from './icons.js';
import { formatPremiereDate } from './lib/format.js';

interface Remaining {
  pastDue: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function computeRemaining(target: number): Remaining {
  const diff = target - Date.now();
  const pastDue = diff <= 0;
  const abs = Math.abs(diff);
  return {
    pastDue,
    days: Math.floor(abs / 86_400_000),
    hours: Math.floor((abs % 86_400_000) / 3_600_000),
    minutes: Math.floor((abs % 3_600_000) / 60_000),
    seconds: Math.floor((abs % 60_000) / 1_000),
  };
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

export function PremiereCountdownCard({
  label,
  productionId,
  productionTitle,
  premiereDate,
}: {
  label: string;
  productionId: string;
  productionTitle: string;
  premiereDate: string;
}) {
  const target = useMemo(() => new Date(`${premiereDate}T00:00:00`).getTime(), [premiereDate]);
  const [remaining, setRemaining] = useState<Remaining | null>(null);

  useEffect(() => {
    setRemaining(computeRemaining(target));
    const id = setInterval(() => setRemaining(computeRemaining(target)), 1000);
    return () => clearInterval(id);
  }, [target]);

  return (
    <Link href={`/productions/${productionId}`} className="card premiere-countdown">
      <div className="premiere-countdown__header">
        <span className="premiere-countdown__icon" aria-hidden="true">
          <TimerIcon />
        </span>
        <span className="premiere-countdown__label">{label}</span>
      </div>
      <p className="premiere-countdown__title">{productionTitle}</p>
      <p className="premiere-countdown__date">
        <CalendarIcon className="icon-inline" /> {formatPremiereDate(premiereDate)}
      </p>

      {remaining && (
        <div className="premiere-countdown__timer" role="timer" aria-live="off">
          {remaining.pastDue ? (
            <span className="premiere-countdown__past">Премьера уже прошла</span>
          ) : remaining.days > 0 ? (
            <>
              <span className="premiere-countdown__digits">{remaining.days}</span>
              <span className="premiere-countdown__unit">
                {' '}
                дн {pad(remaining.hours)}:{pad(remaining.minutes)}:{pad(remaining.seconds)}
              </span>
            </>
          ) : (
            <span className="premiere-countdown__digits premiere-countdown__digits--tight">
              {pad(remaining.hours)}:{pad(remaining.minutes)}:{pad(remaining.seconds)}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
