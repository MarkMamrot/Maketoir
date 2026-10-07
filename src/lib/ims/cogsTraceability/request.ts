import { fields, metrics, type Basis, type Field, type Filter } from './domain';

export class ReportValidationError extends Error {}

export interface ReportRequest {
  basis: Basis; from: string; to: string; toExclusive: string; page: number; pageSize: number;
  groups: Field[]; filters: Filter[]; sort: Field; direction: 'asc' | 'desc'; columns: Field[];
}

function date(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ReportValidationError('Dates must use YYYY-MM-DD.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new ReportValidationError('Invalid calendar date.');
  return value;
}

function field(value: string): Field {
  if (!Object.prototype.hasOwnProperty.call(fields, value)) throw new ReportValidationError('Unknown report field.');
  return value as Field;
}

export function parseRequest(params: URLSearchParams, today = new Date().toISOString().slice(0, 10)): ReportRequest {
  const basis = params.get('basis') ?? 'movement';
  if (basis !== 'movement' && basis !== 'sale') throw new ReportValidationError('Invalid date basis.');
  const window = Number(params.get('window') ?? 30);
  if (!Number.isInteger(window) || window < 1 || window > 3650) throw new ReportValidationError('Invalid date window.');
  const to = date(params.get('to') || today);
  const end = new Date(`${to}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - window + 1);
  const from = date(params.get('from') || start.toISOString().slice(0, 10));
  if (from > to || (end.getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000 > 3650) throw new ReportValidationError('Choose a date range of up to ten years.');
  end.setUTCDate(end.getUTCDate() + 1);
  const page = Number(params.get('page') ?? 1);
  const pageSize = Number(params.get('pageSize') ?? 50);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) throw new ReportValidationError('Invalid page size or page.');
  const groups = (params.get('groups') || '').split(',').filter(Boolean).map(field);
  if (groups.length > 4 || new Set(groups).size !== groups.length) throw new ReportValidationError('Choose up to four distinct grouping fields.');
  let rawFilters: unknown;
  try { rawFilters = JSON.parse(params.get('filters') || '[]'); } catch { throw new ReportValidationError('Invalid report filters.'); }
  if (!Array.isArray(rawFilters) || rawFilters.length > 20) throw new ReportValidationError('Choose up to twenty filters.');
  const filters = rawFilters.map((raw): Filter => {
    if (!raw || typeof raw !== 'object' || typeof raw.field !== 'string' || typeof raw.value !== 'string' || raw.value.length > 300) throw new ReportValidationError('Invalid report filter.');
    const selected = field(raw.field);
    if (!['equals', 'contains', 'gte', 'lte', 'missing'].includes(raw.operator)) throw new ReportValidationError('Invalid filter operator.');
    if (['gte', 'lte'].includes(raw.operator) && metrics.includes(selected) && !Number.isFinite(Number(raw.value))) throw new ReportValidationError('Numeric bounds must be numbers.');
    return { field: selected, operator: raw.operator, value: raw.value };
  });
  const direction = params.get('direction') ?? 'desc';
  if (direction !== 'asc' && direction !== 'desc') throw new ReportValidationError('Invalid sorting direction.');
  return { basis, from, to, toExclusive: end.toISOString().slice(0, 10), page, pageSize, groups, filters,
    sort: field(params.get('sort') || (basis === 'movement' ? 'movementDate' : 'saleDate')), direction,
    columns: params.has('columns') ? (params.get('columns') || '').split(',').filter(Boolean).map(field) : Object.keys(fields) as Field[] };
}