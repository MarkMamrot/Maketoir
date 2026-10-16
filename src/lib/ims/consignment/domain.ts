import { createHash } from 'crypto';

export const CONSIGNMENT_TRACKING_KEY = 'feature_toggle_consignment_tracking';
export const ACTIVITY_LABEL = 'Activity report - not a settlement or outstanding balance';
export const ACCOUNTING_GUIDANCE = 'Record supplier cost once in Xero, normally as a supplier bill to the agreed cost-of-sales account. A direct bank expense is an alternative, not an additional expense. Accounted does not mean paid. Negative statements require bookkeeper review for a supplier credit. Solvantis does not post consignment COGS.';
export type StatementStatus = 'Draft' | 'Finalised' | 'Accounted' | 'Cancelled';
export type SourceType = 'sale' | 'refund' | 'refund_reversal' | 'supplier_return' | 'correction';
export interface ConsignmentEvent {
  id: number; business_id: string; supplier_id: number; source_type: SourceType;
  source_id: string; source_line_id: string; event_key: string; original_event_id: number | null;
  variant_id: string; sku: string | null; product_name: string | null; location_id: number | null;
  channel: string | null; event_date: string; quantity: number | string;
  unit_cost: number | string | null; tax_rate: number | string | null;
  tracking_interval_id: number | null; statement_id: number | null; exception: string | null;
  evidence_reference?: string | null;
}
export class ConsignmentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function requireDate(value: unknown, label = 'Date'): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new ConsignmentError(`${label} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}
export function localDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export function requirePeriod(from: unknown, to: unknown) {
  const start = requireDate(from, 'From'); const end = requireDate(to, 'To');
  if (start > end) throw new ConsignmentError('From must not be after To.');
  return { from: start, to: end };
}
export function requireId(value: unknown, label = 'ID'): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ConsignmentError(`${label} must be a positive integer.`);
  return id;
}
export function requireText(value: unknown, label: string, max = 1000): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ConsignmentError(`${label} is required (maximum ${max} characters).`);
  return value.trim();
}
function decimal(value: string | number, precision: number): bigint {
  const text = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new ConsignmentError('Invalid source amount.');
  const negative = text.startsWith('-'); const [whole, fraction = ''] = text.replace('-', '').split('.');
  const result = BigInt(whole + fraction.padEnd(precision, '0').slice(0, precision));
  return negative ? -result : result;
}
function divideRounded(value: bigint, divisor: bigint): bigint {
  const sign = value < BigInt(0) ? -BigInt(1) : BigInt(1);
  return sign * ((value * sign + divisor / BigInt(2)) / divisor);
}
export function eventAmounts(event: Pick<ConsignmentEvent, 'quantity' | 'unit_cost' | 'tax_rate' | 'source_type'>) {
  if (event.source_type === 'supplier_return') return { subtotal: 0, tax: 0, total: 0 };
  if (event.unit_cost == null || event.tax_rate == null) return { subtotal: 0, tax: 0, total: 0 };
  const quantity = decimal(event.quantity, 6); const cost = decimal(event.unit_cost, 8);
  const subtotal = divideRounded(quantity * cost, BigInt('1000000000000'));
  const tax = divideRounded(quantity * cost * decimal(event.tax_rate, 6), BigInt('100000000000000000000'));
  if (![subtotal, tax, subtotal + tax].every(value => Number.isSafeInteger(Number(value)))) throw new ConsignmentError('Source amount exceeds the supported safe accounting range.');
  return { subtotal: Number(subtotal) / 100, tax: Number(tax) / 100, total: Number(subtotal + tax) / 100 };
}
export function eventExceptions(event: ConsignmentEvent): string[] {
  const issues: string[] = [];
  if (event.exception) issues.push(event.exception);
  if (!['sale', 'refund', 'refund_reversal', 'supplier_return', 'correction'].includes(event.source_type)) issues.push('Unsupported source type.');
  if (!Number.isFinite(Number(event.quantity)) || Number(event.quantity) === 0) issues.push('Missing or invalid quantity.');
  if (['sale', 'refund_reversal'].includes(event.source_type) && Number(event.quantity) < 0) issues.push('Invalid positive source quantity.');
  if ((event.source_type === 'refund' || event.source_type === 'supplier_return' && !event.original_event_id)
    && Number(event.quantity) > 0) issues.push('Invalid negative source quantity.');
  if (event.source_type !== 'supplier_return') {
    if (event.unit_cost == null || !Number.isFinite(Number(event.unit_cost)) || Number(event.unit_cost) < 0) issues.push('Missing or invalid captured supplier cost.');
    if (event.tax_rate == null || !Number.isFinite(Number(event.tax_rate)) || Number(event.tax_rate) < 0 || Number(event.tax_rate) > 100) issues.push('Missing or invalid captured supplier tax.');
    if (['refund', 'refund_reversal', 'correction'].includes(event.source_type) && !event.original_event_id) issues.push('Missing linked original event.');
  }
  return issues;
}
export function projectActivity(events: ConsignmentEvent[]) {
  const grouped = new Map<string, {
    supplierId: number; variantId: string; sku: string | null; productName: string | null;
    unitCost: number | null; taxRate: number | null; quantitySold: number; quantityRefunded: number;
    quantityAdjusted: number; netQuantity: number; subtotal: number; tax: number; total: number;
  }>();
  const exceptions = events.flatMap(event => eventExceptions(event).map(message => ({ eventId: event.id, message })));
  let subtotalCents = 0; let taxCents = 0;
  for (const event of events) {
    if (event.source_type === 'supplier_return') continue;
    const key = JSON.stringify([event.supplier_id, event.variant_id, event.unit_cost == null ? null : Number(event.unit_cost), event.tax_rate == null ? null : Number(event.tax_rate)]);
    const row = grouped.get(key) ?? {
      supplierId: event.supplier_id, variantId: event.variant_id, sku: event.sku, productName: event.product_name,
      unitCost: event.unit_cost == null ? null : Number(event.unit_cost), taxRate: event.tax_rate == null ? null : Number(event.tax_rate),
      quantitySold: 0, quantityRefunded: 0, quantityAdjusted: 0, netQuantity: 0, subtotal: 0, tax: 0, total: 0,
    };
    const quantity = Number(event.quantity);
    if (event.source_type === 'sale') row.quantitySold = Math.round((row.quantitySold + quantity) * 1e6) / 1e6;
    else if (event.source_type === 'refund' || event.source_type === 'refund_reversal') row.quantityRefunded = Math.round((row.quantityRefunded - quantity) * 1e6) / 1e6;
    else if (event.source_type === 'correction') row.quantityAdjusted = Math.round((row.quantityAdjusted + quantity) * 1e6) / 1e6;
    row.netQuantity = Math.round((row.netQuantity + quantity) * 1e6) / 1e6;
    const amounts = eventExceptions(event).some(issue => issue.startsWith('Missing or invalid')) ? { subtotal: 0, tax: 0, total: 0 } : eventAmounts(event);
    row.subtotal = Math.round((row.subtotal + amounts.subtotal) * 100) / 100;
    row.tax = Math.round((row.tax + amounts.tax) * 100) / 100;
    row.total = Math.round((row.total + amounts.total) * 100) / 100;
    subtotalCents += Math.round(amounts.subtotal * 100); taxCents += Math.round(amounts.tax * 100);
    grouped.set(key, row);
  }
  const rows = [...grouped.values()];
  return {
    label: ACTIVITY_LABEL, events, rows, exceptions,
    totals: {
      quantitySold: Math.round(rows.reduce((n, row) => n + row.quantitySold, 0) * 1e6) / 1e6,
      quantityRefunded: Math.round(rows.reduce((n, row) => n + row.quantityRefunded, 0) * 1e6) / 1e6,
      quantityAdjusted: Math.round(rows.reduce((n, row) => n + row.quantityAdjusted, 0) * 1e6) / 1e6,
      netQuantity: Math.round(rows.reduce((n, row) => n + row.netQuantity, 0) * 1e6) / 1e6,
      subtotal: subtotalCents / 100, tax: taxCents / 100, total: (subtotalCents + taxCents) / 100,
    },
  };
}
export function eventFingerprint(events: ConsignmentEvent[]): string {
  return createHash('sha256').update(JSON.stringify([...events].sort((a, b) => a.id - b.id).map(event => ({
    id: event.id, key: event.event_key, business: event.business_id, supplier: event.supplier_id,
    sourceType: event.source_type, source: event.source_id, sourceLine: event.source_line_id, original: event.original_event_id,
    variant: event.variant_id, sku: event.sku, productName: event.product_name, location: event.location_id,
    channel: event.channel, date: event.event_date, evidence: event.evidence_reference ?? null,
    quantity: String(event.quantity), cost: event.unit_cost == null ? null : String(event.unit_cost),
    tax: event.tax_rate == null ? null : String(event.tax_rate), exception: event.exception, interval: event.tracking_interval_id,
  })))).digest('hex');
}
export function assertTransition(status: StatementStatus, action: string) {
  const allowed: Record<string, StatementStatus[]> = { refresh: ['Draft'], finalise: ['Draft'], account: ['Finalised'], cancel: ['Draft', 'Finalised'] };
  if (!allowed[action]?.includes(status)) throw new ConsignmentError(`Cannot ${action} a ${status} statement.`, 409);
}
export function safeCsvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
