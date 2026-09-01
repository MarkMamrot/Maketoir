export type BulkProductSortKey = 'created_at' | 'name' | 'inventory' | 'rrp' | 'cost';
export type BulkProductSortDirection = 'asc' | 'desc';
export type BulkProductFilterJoin = 'and' | 'or';
export type BulkProductFilterField = 'status' | 'website' | 'shopify' | 'soh' | 'available' | 'zone' | 'bin' | 'min_qty' | 'reorder_point' | 'rrp' | 'cost';
export type BulkProductFilterOperator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains';

export interface BulkProductFilter {
  id: string;
  field: BulkProductFilterField;
  operator: BulkProductFilterOperator;
  value: string;
}

export interface BulkProductWorkspaceSettings {
  selectedFields: string[];
  sortKey: BulkProductSortKey;
  sortDirection: BulkProductSortDirection;
  filterJoin: BulkProductFilterJoin;
  filters: BulkProductFilter[];
  query: string;
  brand: string;
  supplier: string;
}

const NUMERIC_FIELDS = new Set<BulkProductFilterField>(['soh', 'available', 'min_qty', 'reorder_point', 'rrp', 'cost']);
const TEXT_FIELDS = new Set<BulkProductFilterField>(['zone', 'bin']);
const BOOLEAN_FIELDS = new Set<BulkProductFilterField>(['status', 'website', 'shopify']);
const NUMERIC_OPERATORS = new Set<BulkProductFilterOperator>(['=', '!=', '>', '<', '>=', '<=']);
const TEXT_OPERATORS = new Set<BulkProductFilterOperator>(['=', '!=', 'contains']);

export const DEFAULT_BULK_PRODUCT_WORKSPACE: BulkProductWorkspaceSettings = {
  selectedFields: [],
  sortKey: 'name',
  sortDirection: 'asc',
  filterJoin: 'and',
  filters: [],
  query: '',
  brand: '',
  supplier: '',
};

export function sanitizeBulkProductFilters(value: unknown): BulkProductFilter[] {
  if (!Array.isArray(value)) return [];
  const filters: BulkProductFilter[] = [];
  for (const candidate of value.slice(0, 20)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const raw = candidate as Record<string, unknown>;
    const field = String(raw.field ?? '') as BulkProductFilterField;
    const operator = String(raw.operator ?? '') as BulkProductFilterOperator;
    const filterValue = String(raw.value ?? '').trim();
    const validOperator = NUMERIC_FIELDS.has(field)
      ? NUMERIC_OPERATORS.has(operator) && filterValue !== '' && Number.isFinite(Number(filterValue))
      : TEXT_FIELDS.has(field)
        ? TEXT_OPERATORS.has(operator) && filterValue !== ''
        : BOOLEAN_FIELDS.has(field) && operator === '=' && ['0', '1'].includes(filterValue);
    if (!validOperator) continue;
    filters.push({ id: String(raw.id ?? `filter-${filters.length + 1}`), field, operator, value: filterValue });
  }
  return filters;
}

export function sanitizeBulkProductWorkspace(value: unknown): BulkProductWorkspaceSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const sortKey = ['created_at', 'name', 'inventory', 'rrp', 'cost'].includes(String(raw.sortKey))
    ? raw.sortKey as BulkProductSortKey
    : DEFAULT_BULK_PRODUCT_WORKSPACE.sortKey;
  return {
    selectedFields: Array.isArray(raw.selectedFields) ? raw.selectedFields.filter((field): field is string => typeof field === 'string').slice(0, 100) : [],
    sortKey,
    sortDirection: raw.sortDirection === 'desc' ? 'desc' : 'asc',
    filterJoin: raw.filterJoin === 'or' ? 'or' : 'and',
    filters: sanitizeBulkProductFilters(raw.filters),
    query: String(raw.query ?? '').trim().slice(0, 200),
    brand: String(raw.brand ?? '').trim().slice(0, 255),
    supplier: String(raw.supplier ?? '').trim().slice(0, 30),
  };
}

function numericCondition(expression: string, filter: BulkProductFilter): { sql: string; params: unknown[] } {
  return { sql: `${expression} ${filter.operator} ?`, params: [Number(filter.value)] };
}

function stockCondition(filter: BulkProductFilter): { sql: string; params: unknown[] } {
  if (filter.field === 'zone' || filter.field === 'bin') {
    const expression = `COALESCE(bs.${filter.field}, '')`;
    return filter.operator === 'contains'
      ? { sql: `${expression} LIKE ?`, params: [`%${filter.value}%`] }
      : { sql: `${expression} ${filter.operator} ?`, params: [filter.value] };
  }
  const expression = filter.field === 'soh'
    ? 'bs.qty_on_hand'
    : filter.field === 'available'
      ? '(bs.qty_on_hand - bs.qty_committed)'
      : filter.field === 'min_qty'
        ? 'bs.min_qty'
        : 'bs.reorder_qty';
  return numericCondition(expression, filter);
}

function stockExists(filters: BulkProductFilter[]): { sql: string; params: unknown[] } {
  const conditions = filters.map(stockCondition);
  return {
    sql: `EXISTS (
      SELECT 1
        FROM ims_product_variants bv
        JOIN ims_stock bs ON bs.variant_id = bv.variant_id AND bs.business_id = bv.business_id
       WHERE bv.product_id = p.product_id AND bv.business_id = p.business_id
         AND ${conditions.map(condition => condition.sql).join(' AND ')}
    )`,
    params: conditions.flatMap(condition => condition.params),
  };
}

function standaloneCondition(filter: BulkProductFilter): { sql: string; params: unknown[] } {
  if (filter.field === 'status') return { sql: 'p.is_active = ?', params: [Number(filter.value)] };
  if (filter.field === 'website') return { sql: 'p.is_online = ?', params: [Number(filter.value)] };
  if (filter.field === 'shopify') return { sql: filter.value === '1' ? "NULLIF(p.shopify_product_id, '') IS NOT NULL" : "NULLIF(p.shopify_product_id, '') IS NULL", params: [] };
  if (filter.field === 'rrp' || filter.field === 'cost') {
    const column = filter.field === 'rrp' ? 'price_rrp' : 'cost_aud';
    const condition = numericCondition(`COALESCE(bv.${column}, 0)`, filter);
    return {
      sql: `EXISTS (SELECT 1 FROM ims_product_variants bv WHERE bv.product_id = p.product_id AND bv.business_id = p.business_id AND ${condition.sql})`,
      params: condition.params,
    };
  }
  return stockExists([filter]);
}

export function buildBulkProductListPlan(input: {
  filters: BulkProductFilter[];
  filterJoin: BulkProductFilterJoin;
  sortKey: BulkProductSortKey;
  sortDirection: BulkProductSortDirection;
}): { filterSql: string; filterParams: unknown[]; orderBySql: string } {
  const filters = sanitizeBulkProductFilters(input.filters);
  let conditions: Array<{ sql: string; params: unknown[] }>;
  if (input.filterJoin === 'and') {
    const stockFilters = filters.filter(filter => ['soh', 'available', 'zone', 'bin', 'min_qty', 'reorder_point'].includes(filter.field));
    conditions = filters.filter(filter => !stockFilters.includes(filter)).map(standaloneCondition);
    if (stockFilters.length) conditions.push(stockExists(stockFilters));
  } else {
    conditions = filters.map(standaloneCondition);
  }

  const sortExpressions: Record<BulkProductSortKey, string> = {
    created_at: 'p.created_at',
    name: 'p.name',
    inventory: `COALESCE((SELECT SUM(ss.qty_on_hand) FROM ims_product_variants sv JOIN ims_stock ss ON ss.variant_id = sv.variant_id AND ss.business_id = sv.business_id WHERE sv.product_id = p.product_id AND sv.business_id = p.business_id), 0)`,
    rrp: `COALESCE((SELECT MIN(NULLIF(sv.price_rrp, 0)) FROM ims_product_variants sv WHERE sv.product_id = p.product_id AND sv.business_id = p.business_id), 0)`,
    cost: `COALESCE((SELECT MIN(NULLIF(sv.cost_aud, 0)) FROM ims_product_variants sv WHERE sv.product_id = p.product_id AND sv.business_id = p.business_id), 0)`,
  };
  const sortKey = Object.prototype.hasOwnProperty.call(sortExpressions, input.sortKey) ? input.sortKey : 'name';
  const direction = input.sortDirection === 'desc' ? 'DESC' : 'ASC';
  return {
    filterSql: conditions.length ? `(${conditions.map(condition => condition.sql).join(input.filterJoin === 'or' ? ' OR ' : ' AND ')})` : '',
    filterParams: conditions.flatMap(condition => condition.params),
    orderBySql: `${sortExpressions[sortKey]} ${direction}, p.name ASC, p.product_id ASC`,
  };
}