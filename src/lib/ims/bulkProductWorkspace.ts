type BulkProductLocationSortField = 'soh' | 'min_qty' | 'reorder_qty' | 'zone' | 'bin';
type BulkProductForeignCurrency = 'USD' | 'EUR' | 'GBP' | 'THB' | 'CNY' | 'JPY';
export type BulkProductSortKey =
  | 'created_at' | 'name' | 'inventory' | 'rrp' | 'cost'
  | 'base_sku' | 'brand' | 'supplier' | 'product_type' | 'category' | 'subcategory' | 'tags' | 'description'
  | 'is_active' | 'is_stock_item' | 'is_online' | 'website_title' | 'allow_indent_wholesale'
  | 'barcode' | 'price_wholesale' | 'price_rrp_sale' | 'discount_start_date' | 'discount_end_date' | 'weight_kg' | 'is_active_variant'
  | `foreign_cost_${BulkProductForeignCurrency}`
  | `location_${number}_${BulkProductLocationSortField}`;
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
const STATIC_SORT_KEYS = new Set<BulkProductSortKey>([
  'created_at', 'name', 'inventory', 'rrp', 'cost', 'base_sku', 'brand', 'supplier', 'product_type', 'category', 'subcategory',
  'tags', 'description', 'is_active', 'is_stock_item', 'is_online', 'website_title', 'allow_indent_wholesale', 'barcode',
  'price_wholesale', 'price_rrp_sale', 'discount_start_date', 'discount_end_date', 'weight_kg', 'is_active_variant',
]);

export function isBulkProductSortKey(value: unknown): value is BulkProductSortKey {
  const key = String(value ?? '');
  return STATIC_SORT_KEYS.has(key as BulkProductSortKey)
    || /^location_[1-9]\d*_(soh|min_qty|reorder_qty|zone|bin)$/.test(key)
    || /^foreign_cost_(USD|EUR|GBP|THB|CNY|JPY)$/.test(key);
}

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
  const sortKey = isBulkProductSortKey(raw.sortKey)
    ? raw.sortKey
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
        JOIN ims_locations bl ON bl.id = bs.location_id AND bl.business_id = bs.business_id AND bl.is_active = 1
       WHERE bv.product_id = p.product_id AND bv.business_id = p.business_id
         AND bv.is_active = 1
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
      sql: `EXISTS (SELECT 1 FROM ims_product_variants bv WHERE bv.product_id = p.product_id AND bv.business_id = p.business_id AND bv.is_active = 1 AND ${condition.sql})`,
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
    inventory: `COALESCE((SELECT SUM(ss.qty_on_hand) FROM ims_product_variants sv JOIN ims_stock ss ON ss.variant_id = sv.variant_id AND ss.business_id = sv.business_id JOIN ims_locations sl ON sl.id = ss.location_id AND sl.business_id = ss.business_id AND sl.is_active = 1 WHERE sv.product_id = p.product_id AND sv.business_id = p.business_id AND sv.is_active = 1), 0)`,
    rrp: `COALESCE((SELECT MIN(NULLIF(sv.price_rrp, 0)) FROM ims_product_variants sv WHERE sv.product_id = p.product_id AND sv.business_id = p.business_id AND sv.is_active = 1), 0)`,
    cost: `COALESCE((SELECT MIN(NULLIF(sv.cost_aud, 0)) FROM ims_product_variants sv WHERE sv.product_id = p.product_id AND sv.business_id = p.business_id AND sv.is_active = 1), 0)`,
    base_sku: 'p.base_sku',
    brand: 'p.brand',
    supplier: 'c.name',
    product_type: 'p.product_type',
    category: 'p.category',
    subcategory: 'p.subcategory',
    tags: 'p.tags',
    description: 'p.description',
    is_active: 'p.is_active',
    is_stock_item: 'p.is_stock_item',
    is_online: 'p.is_online',
    website_title: 'p.website_title',
    allow_indent_wholesale: 'p.allow_indent_wholesale',
    barcode: `COALESCE((SELECT MIN(sv.barcode) FROM ims_product_variants sv WHERE sv.product_id = p.product_id AND sv.business_id = p.business_id AND sv.is_active = 1), '')`,
    price_wholesale: `COALESCE((SELECT MIN(sv.price_wholesale) FROM ims_product_variants sv WHERE sv.product_id = p.product_id AND sv.business_id = p.business_id AND sv.is_active = 1), 0)`,
    price_rrp_sale: `COALESCE((SELECT MIN(sv.price_rrp_sale) FROM ims_product_variants sv WHERE sv.product_id = p.product_id AND sv.business_id = p.business_id AND sv.is_active = 1), 0)`,
    discount_start_date: `COALESCE((SELECT MIN(sv.discount_start_date) FROM ims_product_variants sv WHERE sv.product_id = p.product_id AND sv.business_id = p.business_id AND sv.is_active = 1), '')`,
    discount_end_date: `COALESCE((SELECT MIN(sv.discount_end_date) FROM ims_product_variants sv WHERE sv.product_id = p.product_id AND sv.business_id = p.business_id AND sv.is_active = 1), '')`,
    weight_kg: `COALESCE((SELECT MIN(sv.weight_kg) FROM ims_product_variants sv WHERE sv.product_id = p.product_id AND sv.business_id = p.business_id AND sv.is_active = 1), 0)`,
    is_active_variant: `COALESCE((SELECT MIN(sv.is_active) FROM ims_product_variants sv WHERE sv.product_id = p.product_id AND sv.business_id = p.business_id), 0)`,
  };
  const sortKey = isBulkProductSortKey(input.sortKey) ? input.sortKey : 'name';
  const locationSort = /^location_(\d+)_(soh|min_qty|reorder_qty|zone|bin)$/.exec(sortKey);
  const foreignCostSort = /^foreign_cost_(USD|EUR|GBP|THB|CNY|JPY)$/.exec(sortKey);
  let sortExpression = sortExpressions[sortKey];
  if (locationSort) {
    const locationId = Number(locationSort[1]);
    const field = locationSort[2] as BulkProductLocationSortField;
    const column = { soh: 'qty_on_hand', min_qty: 'min_qty', reorder_qty: 'reorder_qty', zone: 'zone', bin: 'bin' }[field];
    const aggregate = field === 'soh' ? 'SUM' : 'MIN';
    const fallback = field === 'zone' || field === 'bin' ? "''" : '0';
    sortExpression = `COALESCE((SELECT ${aggregate}(bs.${column}) FROM ims_product_variants bv JOIN ims_stock bs ON bs.variant_id = bv.variant_id AND bs.business_id = bv.business_id JOIN ims_locations bl ON bl.id = bs.location_id AND bl.business_id = bs.business_id AND bl.is_active = 1 WHERE bv.product_id = p.product_id AND bv.business_id = p.business_id AND bv.is_active = 1 AND bs.location_id = ${locationId}), ${fallback})`;
  }
  if (foreignCostSort) {
    const currencyCode = foreignCostSort[1] as BulkProductForeignCurrency;
    sortExpression = `COALESCE((SELECT MIN(CAST(JSON_UNQUOTE(JSON_EXTRACT(sv.cost_foreign, '$.${currencyCode}')) AS DECIMAL(18,4))) FROM ims_product_variants sv WHERE sv.product_id = p.product_id AND sv.business_id = p.business_id AND sv.is_active = 1), 0)`;
  }
  const direction = input.sortDirection === 'desc' ? 'DESC' : 'ASC';
  return {
    filterSql: conditions.length ? `(${conditions.map(condition => condition.sql).join(input.filterJoin === 'or' ? ' OR ' : ' AND ')})` : '',
    filterParams: conditions.flatMap(condition => condition.params),
    orderBySql: `${sortExpression} ${direction}, p.name ASC, p.product_id ASC`,
  };
}