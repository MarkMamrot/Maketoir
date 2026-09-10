export interface ProductCustomsFields {
  customs_description: string | null;
  hs_code: string | null;
  country_of_origin: string | null;
  is_dangerous_or_restricted: number;
}

export interface ProductCustomsValidationError {
  field: keyof ProductCustomsFields;
  message: string;
}

function hasOwn(input: Record<string, unknown>, field: keyof ProductCustomsFields): boolean {
  return Object.prototype.hasOwnProperty.call(input, field);
}

function nullableText(
  input: Record<string, unknown>,
  field: 'customs_description' | 'hs_code',
  maximumLength: number,
  label: string,
  values: Partial<ProductCustomsFields>,
  errors: ProductCustomsValidationError[],
): void {
  if (!hasOwn(input, field)) return;
  const raw = input[field];
  if (raw === undefined || raw === null || raw === '') {
    values[field] = null;
    return;
  }
  if (typeof raw !== 'string') {
    errors.push({ field, message: `${label} must be text.` });
    return;
  }
  const normalized = raw.trim();
  if (normalized.length > maximumLength) {
    errors.push({ field, message: `${label} must be ${maximumLength} characters or fewer.` });
    return;
  }
  values[field] = normalized || null;
}

export function normalizeProductCustomsFields(input: unknown): {
  values: Partial<ProductCustomsFields>;
  errors: ProductCustomsValidationError[];
} {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const values: Partial<ProductCustomsFields> = {};
  const errors: ProductCustomsValidationError[] = [];

  nullableText(source, 'customs_description', 250, 'Customs description', values, errors);
  nullableText(source, 'hs_code', 14, 'HS code', values, errors);

  if (hasOwn(source, 'country_of_origin')) {
    const raw = source.country_of_origin;
    if (raw === undefined || raw === null || raw === '') {
      values.country_of_origin = null;
    } else if (typeof raw !== 'string' || !/^[A-Za-z]{2}$/.test(raw.trim())) {
      errors.push({ field: 'country_of_origin', message: 'Country of origin must be a two-letter country code.' });
    } else {
      values.country_of_origin = raw.trim().toUpperCase();
    }
  }

  if (hasOwn(source, 'is_dangerous_or_restricted')) {
    const raw = source.is_dangerous_or_restricted;
    if (raw === true || raw === 1 || raw === '1') values.is_dangerous_or_restricted = 1;
    else if (raw === false || raw === 0 || raw === '0') values.is_dangerous_or_restricted = 0;
    else errors.push({ field: 'is_dangerous_or_restricted', message: 'Dangerous or restricted must be true or false.' });
  }

  return { values, errors };
}