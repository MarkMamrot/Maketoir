import type { AiCycleMode } from './types';

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function atUtcDay(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, Math.min(day, daysInUtcMonth(year, monthIndex))));
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month) - 1, day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second) };
}

function zonedMidnight(year: number, monthIndex: number, day: number, timeZone: string): Date {
  const normalized = new Date(Date.UTC(year, monthIndex, 1));
  const targetYear = normalized.getUTCFullYear();
  const targetMonth = normalized.getUTCMonth();
  const targetDay = Math.min(day, daysInUtcMonth(targetYear, targetMonth));
  let instant = new Date(Date.UTC(targetYear, targetMonth, targetDay));
  for (let attempt = 0; attempt < 3; attempt++) {
    const actual = localParts(instant, timeZone);
    const difference = Date.UTC(actual.year, actual.month, actual.day, actual.hour, actual.minute, actual.second) - Date.UTC(targetYear, targetMonth, targetDay);
    instant = new Date(instant.getTime() - difference);
  }
  return instant;
}

export function calculateCycle(
  mode: AiCycleMode,
  now: Date,
  anchorDay = 1,
  timeZone = 'UTC',
): { start: Date; end: Date } | null {
  if (mode === 'manual') return null;
  const local = localParts(now, timeZone);
  const year = local.year;
  const month = local.month;
  if (mode === 'calendar_month') {
    return { start: zonedMidnight(year, month, 1, timeZone), end: zonedMidnight(year, month + 1, 1, timeZone) };
  }
  const currentAnchor = zonedMidnight(year, month, Math.max(1, Math.min(31, anchorDay)), timeZone);
  const startMonth = now >= currentAnchor ? month : month - 1;
  return { start: zonedMidnight(year, startMonth, anchorDay, timeZone), end: zonedMidnight(year, startMonth + 1, anchorDay, timeZone) };
}