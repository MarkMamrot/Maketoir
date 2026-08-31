function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function generateProductSku(brand: unknown, now = new Date()): string {
  const brandLetters = String(brand ?? '').toUpperCase().match(/[A-Z]/g)?.slice(0, 3).join('') ?? '';
  const prefix = brandLetters || 'SOL';
  const date = `${String(now.getFullYear()).slice(-2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}-${date}-${time}`;
}