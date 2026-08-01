export interface CampaignMeasurementSchedule {
  horizonDays: number;
  baselineStart: string;
  baselineEnd: string;
  followupStart: string;
  followupEnd: string;
  firstAssessmentDate: string;
}

function isoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('activationDate must be a valid YYYY-MM-DD date.');
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('activationDate must be a valid YYYY-MM-DD date.');
  }
  return date;
}

function addDays(value: Date, days: number): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildCampaignMeasurementSchedule(
  activationDate: string,
  horizonDays: number,
): CampaignMeasurementSchedule {
  const activation = isoDate(activationDate);
  const horizon = Math.trunc(horizonDays);
  if (!Number.isInteger(horizonDays) || horizon < 1 || horizon > 90) {
    throw new Error('horizonDays must be an integer from 1 to 90.');
  }
  return {
    horizonDays: horizon,
    baselineStart: addDays(activation, -horizon),
    baselineEnd: addDays(activation, -1),
    followupStart: addDays(activation, 1),
    followupEnd: addDays(activation, horizon),
    firstAssessmentDate: addDays(activation, horizon + 1),
  };
}