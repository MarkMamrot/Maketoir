interface ResolveEodOpeningFloatInput {
  paymentMethod: string;
  savedOpeningFloat?: unknown;
  sessionOpeningFloat?: unknown;
  defaultOpeningFloat?: unknown;
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveEodOpeningFloat(input: ResolveEodOpeningFloatInput): number {
  const saved = finiteNumber(input.savedOpeningFloat);
  if (saved != null) return saved;
  if (input.paymentMethod.trim().toLowerCase() !== 'cash') return 0;

  return finiteNumber(input.sessionOpeningFloat)
    ?? finiteNumber(input.defaultOpeningFloat)
    ?? 0;
}