export type CogsCostSource = 'cost_aud' | 'average_cost' | 'foreign_current_fx' | 'manual';

export interface CogsCostRepairInput {
  movementId: number;
  expectedUnitCost: number | null;
  newUnitCost: number;
  source: CogsCostSource;
  sourceDetail?: Record<string, unknown> | null;
  reason: string;
  fifoWarningAccepted: boolean;
}

export interface ForeignCostHint { currency: string; amount: number }

export function parseForeignCostHints(value: string | null | undefined): ForeignCostHint[] {
  try {
    const parsed = JSON.parse(value ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.entries(parsed).flatMap(([currency, raw]) => {
      const amount = Number(raw);
      const code = currency.trim().toUpperCase();
      return /^[A-Z]{3}$/.test(code) && Number.isFinite(amount) && amount > 0 ? [{ currency: code, amount }] : [];
    }).sort((left, right) => left.currency.localeCompare(right.currency));
  } catch { return []; }
}

export function normalizeCogsCostRepairs(value: unknown): CogsCostRepairInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) throw new Error('Choose between 1 and 500 movement cost repairs.');
  const ids = new Set<number>();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid movement cost repair.');
    const item = raw as Record<string, unknown>;
    const movementId = Number(item.movementId);
    const expectedUnitCost = item.expectedUnitCost == null ? null : Number(item.expectedUnitCost);
    const newUnitCost = Number(item.newUnitCost);
    const source = String(item.source ?? '') as CogsCostSource;
    const reason = String(item.reason ?? '').trim();
    if (!Number.isInteger(movementId) || movementId <= 0 || ids.has(movementId)) throw new Error('Each movement must appear once with a valid ID.');
    if (expectedUnitCost != null && !Number.isFinite(expectedUnitCost)) throw new Error('The expected movement cost is invalid.');
    if (!Number.isFinite(newUnitCost) || newUnitCost <= 0 || newUnitCost > 99999999) throw new Error('Each repaired unit cost must be greater than zero.');
    if (!['cost_aud', 'average_cost', 'foreign_current_fx', 'manual'].includes(source)) throw new Error('Choose a valid cost source.');
    if (reason.length < 3 || reason.length > 500) throw new Error('Enter a repair reason between 3 and 500 characters.');
    ids.add(movementId);
    return { movementId, expectedUnitCost, newUnitCost: Math.round(newUnitCost * 10000) / 10000, source,
      sourceDetail: item.sourceDetail && typeof item.sourceDetail === 'object' && !Array.isArray(item.sourceDetail) ? item.sourceDetail as Record<string, unknown> : null,
      reason, fifoWarningAccepted: item.fifoWarningAccepted === true };
  });
}