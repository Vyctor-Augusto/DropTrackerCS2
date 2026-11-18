/**
 * Regra de reset do drop semanal.
 *
 * O reset do CS2 acontece uma vez por semana, sempre no mesmo dia/horário.
 * Guardamos a regra em UTC para não sofrer com fuso horário / horário de verão.
 * A interface mostra o horário equivalente no fuso do navegador.
 */

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

/** Dia da semana ISO: 1 = segunda ... 7 = domingo. */
export const WEEKDAYS = [
  { id: 1, name: 'Segunda-feira' },
  { id: 2, name: 'Terça-feira' },
  { id: 3, name: 'Quarta-feira' },
  { id: 4, name: 'Quinta-feira' },
  { id: 5, name: 'Sexta-feira' },
  { id: 6, name: 'Sábado' },
  { id: 7, name: 'Domingo' },
];

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeRule(settings) {
  const s = settings || {};
  return {
    weekday: clampInt(s.resetWeekday, 1, 7, 2),
    hour: clampInt(s.resetHour, 0, 23, 0),
    minute: clampInt(s.resetMinute, 0, 59, 0),
  };
}

/** Início (em ms) da semana de drop que contém `now`. */
export function weekStart(now, settings) {
  const { weekday, hour, minute } = normalizeRule(settings);
  const d = now instanceof Date ? now : new Date(now);
  const nowMs = d.getTime();

  const base = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    hour,
    minute,
    0,
    0,
  );

  const jsDow = new Date(base).getUTCDay(); // 0 = domingo
  const isoDow = jsDow === 0 ? 7 : jsDow;

  let diff = isoDow - weekday;
  if (diff < 0) diff += 7;

  let start = base - diff * DAY_MS;
  if (start > nowMs) start -= WEEK_MS;
  return start;
}

export function weekEnd(now, settings) {
  return weekStart(now, settings) + WEEK_MS;
}

/** Identificador estável da semana (data ISO do início dela). */
export function weekKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function weekWindow(now, settings) {
  const start = weekStart(now, settings);
  return { start, end: start + WEEK_MS, key: weekKey(start) };
}

export function describeRule(settings) {
  const { weekday, hour, minute } = normalizeRule(settings);
  const label = WEEKDAYS.find((w) => w.id === weekday)?.name || 'Terça-feira';
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${label} ${hh}:${mm} UTC`;
}
