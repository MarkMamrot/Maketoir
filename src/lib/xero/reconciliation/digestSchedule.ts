export type ReconciliationDigestFrequency = 'off' | 'daily' | 'weekly';

export type ReconciliationDigestSchedule = {
  due: boolean;
  periodKey: string | null;
  scheduledLocalDate: string | null;
};

function localParts(date: Date, timeZone: string): { date: string; hour: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function addLocalDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function localWeekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function getReconciliationDigestSchedule(input: {
  now: Date;
  lastCompletedAt: Date | null;
  timeZone: string;
  frequency: ReconciliationDigestFrequency;
  localHour: number;
  weeklyDay: number;
}): ReconciliationDigestSchedule {
  if (input.frequency === 'off') return { due: false, periodKey: null, scheduledLocalDate: null };
  const localNow = localParts(input.now, input.timeZone);
  const hour = Math.max(0, Math.min(23, Math.floor(input.localHour)));
  let scheduledLocalDate = localNow.date;
  if (input.frequency === 'daily') {
    if (localNow.hour < hour) scheduledLocalDate = addLocalDays(scheduledLocalDate, -1);
  } else {
    const weeklyDay = Math.max(0, Math.min(6, Math.floor(input.weeklyDay)));
    let daysSinceScheduled = (localWeekday(scheduledLocalDate) - weeklyDay + 7) % 7;
    if (daysSinceScheduled === 0 && localNow.hour < hour) daysSinceScheduled = 7;
    scheduledLocalDate = addLocalDays(scheduledLocalDate, -daysSinceScheduled);
  }
  const lastLocal = input.lastCompletedAt ? localParts(input.lastCompletedAt, input.timeZone) : null;
  const due = !lastLocal || lastLocal.date < scheduledLocalDate
    || (lastLocal.date === scheduledLocalDate && lastLocal.hour < hour);
  return {
    due,
    scheduledLocalDate,
    periodKey: `${input.frequency}-${scheduledLocalDate}`,
  };
}