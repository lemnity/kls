export function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function formatPremiereDate(premiereDate: string | null): string {
  if (!premiereDate) return 'Дата премьеры не назначена';
  return `Премьера · ${formatDateOnly(premiereDate)}`;
}

/** Bare `ДД.ММ.ГГГГ` date, no leading label — for use next to a `<dt>` that already names the field. */
export function formatDateOnly(dateOnly: string | null): string {
  if (!dateOnly) return 'Не назначена';
  const [year, month, day] = dateOnly.split('-');
  return `${day}.${month}.${year}`;
}

const HEALTH_VALUE_LABEL: Record<string, string> = {
  neutral: 'Пока не оценено',
  good: 'Всё по плану',
  at_risk: 'Есть риски',
  warning: 'Есть риски',
  critical: 'Критично',
  bad: 'Критично',
};

export function healthLabel(healthStatus: string): string {
  if (healthStatus === 'neutral') return 'Индикатор здоровья: пока не оценено';
  return `Индикатор здоровья: ${healthStatus}`;
}

/** Bare health value, no leading label — for use next to a `<dt>` that already names the field. */
export function healthValueLabel(healthStatus: string): string {
  return HEALTH_VALUE_LABEL[healthStatus] ?? healthStatus;
}

export function humanizeStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

/**
 * Loose keyword heuristic mapping a free-text production status to a status
 * pill "tone" (color). Falls back to the default accent tone when nothing
 * matches — this is purely presentational and never changes the underlying
 * status value shown to the user.
 */
export function productionStatusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' | undefined {
  const value = status.toLowerCase();
  if (/(approved|complete|done|premiere|готов|утвержд|выпущ)/.test(value)) return 'success';
  if (/(risk|hold|paus|отмен|cancel|reject)/.test(value)) return 'danger';
  if (/(draft|черновик|planned|план)/.test(value)) return 'neutral';
  return undefined;
}
