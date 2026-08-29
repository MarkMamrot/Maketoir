export const AUD_MICROS_PER_DOLLAR = 1_000_000n;

export function audToMicros(value: string | number): bigint {
  const normalized = String(value).trim();
  if (!/^-?\d+(\.\d{1,6})?$/.test(normalized)) throw new Error('AUD amount must have at most six decimal places.');
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ''] = unsigned.split('.');
  const micros = BigInt(whole) * AUD_MICROS_PER_DOLLAR + BigInt(fraction.padEnd(6, '0'));
  return negative ? -micros : micros;
}

export function microsToAud(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / AUD_MICROS_PER_DOLLAR;
  const fraction = String(absolute % AUD_MICROS_PER_DOLLAR).padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function priceUnits(units: number, pricePerMillionMicros: bigint): bigint {
  if (!Number.isSafeInteger(units) || units < 0) throw new Error('Usage units must be a non-negative safe integer.');
  return (BigInt(units) * pricePerMillionMicros + 999_999n) / 1_000_000n;
}