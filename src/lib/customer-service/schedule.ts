import { normalizeRunTimes } from './types';

export interface CsDueSchedule {
  due: boolean;
  scheduledLocalTime: string | null;
}

function localDateParts(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function localMinuteKey(date: Date, timeZone: string): string {
  const parts = localDateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function getDueCustomerServiceSchedule(input: {
  now: Date;
  lastRunAt: Date | null;
  timeZone: string;
  runTimes: unknown;
  dispatcherWindowMinutes?: number;
}): CsDueSchedule {
  const windowMinutes = Math.max(1, Math.min(60, input.dispatcherWindowMinutes ?? 15));
  const currentLocalKey = localMinuteKey(input.now, input.timeZone);
  const lastRunLocalKey = input.lastRunAt ? localMinuteKey(input.lastRunAt, input.timeZone) : null;

  for (const runTime of normalizeRunTimes(input.runTimes)) {
    const scheduledLocalKey = `${currentLocalKey.slice(0, 10)}T${runTime}`;
    if (scheduledLocalKey <= (lastRunLocalKey ?? '') || scheduledLocalKey > currentLocalKey) continue;

    const scheduledMinutes = Number(runTime.slice(0, 2)) * 60 + Number(runTime.slice(3));
    const currentMinutes = Number(currentLocalKey.slice(11, 13)) * 60 + Number(currentLocalKey.slice(14));
    if (currentMinutes - scheduledMinutes < windowMinutes) {
      return { due: true, scheduledLocalTime: scheduledLocalKey };
    }
  }

  return { due: false, scheduledLocalTime: null };
}