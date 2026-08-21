export type SalesOrderUploadAddress = {
  address: string | null;
  address2: string | null;
  suburb: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
};

export type SalesOrderUploadLine = {
  product_code: string | null;
  barcode: string | null;
  product_name: string;
  variant_description: string | null;
  qty: number;
};

export type ParsedSalesOrderUpload = {
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_po_number: string | null;
  order_date: string | null;
  delivery_address: SalesOrderUploadAddress;
  notes: string | null;
  line_items: SalesOrderUploadLine[];
};

export type SalesOrderUploadCustomer = {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  price_tier?: string | null;
};

export type SalesOrderUploadVariant = {
  variant_id: string;
  sku?: string | null;
  barcode?: string | null;
  product_name?: string | null;
  variant_label?: string | null;
  price_rrp?: number | null;
  price_rrp_sale?: number | null;
  price_wholesale?: number | null;
};

export type SalesOrderUploadMatch<T> = T & {
  confidence: 'exact' | 'exact_sku' | 'exact_barcode' | 'fuzzy_name';
  method: string;
};

function text(value: unknown, maxLength = 500): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function textList(value: unknown): string | null {
  const values = Array.isArray(value) ? value : [value];
  const lines = values.map(item => text(item, 1000)).filter((item): item is string => !!item);
  return lines.length > 0 ? lines.join('\n').slice(0, 4000) : null;
}

function identifier(value: unknown): string | null {
  return text(value, 255);
}

export function normalizeSalesOrderUpload(raw: any): ParsedSalesOrderUpload {
  const rawAddress = raw?.delivery_address && typeof raw.delivery_address === 'object'
    ? raw.delivery_address
    : {};
  const rawLines = Array.isArray(raw?.line_items) ? raw.line_items : [];

  const line_items = rawLines.flatMap((line: any): SalesOrderUploadLine[] => {
    const qty = Number(line?.qty ?? line?.quantity);
    const productName = text(line?.product_name ?? line?.description, 500) ?? '';
    const productCode = identifier(line?.product_code ?? line?.sku ?? line?.item_code);
    const barcode = identifier(line?.barcode ?? line?.ean ?? line?.upc ?? line?.gtin);
    if (!Number.isFinite(qty) || qty <= 0 || (!productName && !productCode && !barcode)) return [];
    return [{
      product_code: productCode,
      barcode,
      product_name: productName,
      variant_description: text(line?.variant_description ?? line?.variant, 500),
      qty: Math.round(qty * 10_000) / 10_000,
    }];
  });

  return {
    customer_name: text(raw?.customer_name ?? raw?.company_name, 255),
    customer_email: text(raw?.customer_email ?? raw?.email, 255),
    customer_phone: text(raw?.customer_phone ?? raw?.phone, 100),
    customer_po_number: text(raw?.customer_po_number ?? raw?.order_number ?? raw?.po_number, 100),
    order_date: text(raw?.order_date, 10),
    delivery_address: {
      address: text(rawAddress.address ?? rawAddress.address_line1 ?? rawAddress.line1, 255),
      address2: text(rawAddress.address2 ?? rawAddress.address_line2 ?? rawAddress.line2, 255),
      suburb: text(rawAddress.suburb, 100),
      city: text(rawAddress.city, 100),
      state: text(rawAddress.state, 100),
      postcode: text(rawAddress.postcode ?? rawAddress.postal_code, 30),
      country: text(rawAddress.country, 100),
    },
    notes: textList(raw?.notes ?? raw?.instructions),
    line_items,
  };
}

function comparable(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizedName(value: unknown): string {
  return comparable(value).replace(/[^a-z0-9]/g, '');
}

export function matchSalesOrderCustomer(
  parsed: Pick<ParsedSalesOrderUpload, 'customer_name' | 'customer_email' | 'customer_phone'>,
  customers: SalesOrderUploadCustomer[],
): SalesOrderUploadMatch<SalesOrderUploadCustomer> | null {
  const email = comparable(parsed.customer_email);
  if (email) {
    const matches = customers.filter(customer => comparable(customer.email) === email);
    if (matches.length === 1) return { ...matches[0], confidence: 'exact', method: 'email' };
  }
  const phone = comparable(parsed.customer_phone).replace(/\D/g, '');
  if (phone) {
    const matches = customers.filter(customer => comparable(customer.phone).replace(/\D/g, '') === phone);
    if (matches.length === 1) return { ...matches[0], confidence: 'exact', method: 'phone' };
  }
  const name = normalizedName(parsed.customer_name);
  if (!name) return null;
  const exact = customers.filter(customer => normalizedName(customer.name) === name);
  if (exact.length === 1) return { ...exact[0], confidence: 'exact', method: 'name' };
  const contains = customers.filter(customer => {
    const candidate = normalizedName(customer.name);
    return name.length >= 4 && candidate.length >= 4 && (candidate.includes(name) || name.includes(candidate));
  });
  return contains.length === 1 ? { ...contains[0], confidence: 'fuzzy_name', method: 'name' } : null;
}

export function matchSalesOrderVariant(
  line: SalesOrderUploadLine,
  variants: SalesOrderUploadVariant[],
): SalesOrderUploadMatch<SalesOrderUploadVariant> | null {
  const code = comparable(line.product_code);
  if (code) {
    const matches = variants.filter(variant => comparable(variant.sku) === code);
    if (matches.length === 1) return { ...matches[0], confidence: 'exact_sku', method: 'SKU' };
  }
  const barcode = comparable(line.barcode || line.product_code);
  if (barcode) {
    const matches = variants.filter(variant => comparable(variant.barcode) === barcode);
    if (matches.length === 1) return { ...matches[0], confidence: 'exact_barcode', method: 'barcode' };
  }
  const soughtName = normalizedName(`${line.product_name} ${line.variant_description ?? ''}`);
  if (soughtName.length < 4) return null;
  const matches = variants.filter(variant => {
    const candidate = normalizedName(`${variant.product_name ?? ''} ${variant.variant_label ?? ''}`);
    return candidate.length >= 4 && (candidate.includes(soughtName) || soughtName.includes(candidate));
  });
  return matches.length === 1 ? { ...matches[0], confidence: 'fuzzy_name', method: 'name' } : null;
}