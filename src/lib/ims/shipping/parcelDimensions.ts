export function millimetresToCentimetreInput(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return String(Number((value / 10).toFixed(3)));
}

export function centimetreInputToMillimetres(value: string): number {
  return Number(value) * 10;
}