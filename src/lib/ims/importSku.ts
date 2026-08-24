export function deriveVariantSku(
  productSku: string | null | undefined,
  optionValues: Array<string | null | undefined>,
): string {
  const baseSku = String(productSku ?? '').trim();
  if (!baseSku) return '';

  const suffix = optionValues
    .map(value => String(value ?? '').trim())
    .filter(value => value && value.toLowerCase() !== 'default')
    .join('-')
    .replace(/\s+/g, '');

  return suffix ? `${baseSku}-${suffix}` : baseSku;
}