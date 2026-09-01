'use client';

import { Fragment, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Columns3, ListFilter, Plus, Save, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import {
  bulkFillTargets,
  enabledBulkProductFields,
  populateBlankProductSkus,
  reconcileVariantMatrix,
  sanitizeBulkProductFieldSelection,
  type BulkProductFieldDefinition,
  type BulkProductFieldOwner,
  type BulkVariantDraft,
  type ProductOptionSet,
} from '@/lib/ims/bulkProductEditor';
import { parseProductSettings } from '@/lib/ims/productSettings';
import {
  DEFAULT_BULK_PRODUCT_WORKSPACE,
  sanitizeBulkProductWorkspace,
  type BulkProductFilter,
  type BulkProductFilterField,
  type BulkProductSortDirection,
  type BulkProductSortKey,
  type BulkProductWorkspaceSettings,
} from '@/lib/ims/bulkProductWorkspace';
import { useTableArrowScroll } from '../../hooks/useTableArrowScroll';

interface LookupOption { id: number | string; name: string }

interface LocationStockDraft {
  quantity: string;
  minQty: string;
  reorderQty: string;
  zone: string;
  bin: string;
}

interface ProductDraft {
  clientId: string;
  productId?: string;
  name: string;
  base_sku: string;
  description: string;
  product_type: string;
  brand: string;
  tags: string;
  category: string;
  subcategory: string;
  style_code: string;
  is_active: number;
  is_stock_item: number;
  is_online: number;
  supplier_contact_id: number | '';
  website_title: string;
  allow_indent_wholesale: number;
  optionSets: ProductOptionSet[];
  variants: VariantDraft[];
  [key: string]: unknown;
}

interface VariantDraft extends BulkVariantDraft {
  sku: string;
  barcode: string;
  cost_aud: string;
  price_rrp: string;
  price_wholesale: string;
  price_rrp_sale: string;
  discount_start_date: string;
  discount_end_date: string;
  weight_kg: string;
  cost_foreign: string;
  foreignCosts: Record<string, string>;
  foreignCostsParseFailed: boolean;
  foreignCostsEdited: boolean;
  locationStock: Record<string, LocationStockDraft>;
  locationEdits: Record<string, true>;
  is_active: number;
}

interface FillState {
  fieldId: string;
  owner: BulkProductFieldOwner;
  sourceRowId: string;
  targetRowId: string;
  value: unknown;
}

interface FillDragCandidate extends FillState {
  startX: number;
  startY: number;
}

interface VisibleRow {
  id: string;
  owner: BulkProductFieldOwner;
  productClientId: string;
  variantClientId?: string;
}

interface BulkProductPreset {
  id: string;
  name: string;
  settings: BulkProductWorkspaceSettings;
  lastUsedAt: string | null;
}

const inputStyle = {
  width: '100%', minWidth: 0, boxSizing: 'border-box' as const, border: '1px solid var(--sv-etch)', borderRadius: 4,
  padding: '6px 7px', background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', fontSize: 12,
};

const buttonStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px solid var(--sv-etch)',
  borderRadius: 6, padding: '7px 10px', background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', fontSize: 12,
  fontWeight: 650, cursor: 'pointer', whiteSpace: 'nowrap' as const,
};

const FOREIGN_CURRENCIES = ['USD', 'EUR', 'GBP', 'THB', 'CNY', 'JPY'];
const FILTER_FIELDS: Array<{ id: BulkProductFilterField; label: string; kind: 'boolean' | 'number' | 'text' }> = [
  { id: 'status', label: 'Status', kind: 'boolean' },
  { id: 'website', label: 'Website Product', kind: 'boolean' },
  { id: 'shopify', label: 'Shopify Synced', kind: 'boolean' },
  { id: 'soh', label: 'SOH', kind: 'number' },
  { id: 'available', label: 'Stock Available', kind: 'number' },
  { id: 'zone', label: 'Zone', kind: 'text' },
  { id: 'bin', label: 'Bin', kind: 'text' },
  { id: 'min_qty', label: 'Min Qty', kind: 'number' },
  { id: 'reorder_point', label: 'Reorder Point', kind: 'number' },
  { id: 'rrp', label: 'RRP', kind: 'number' },
  { id: 'cost', label: 'Cost', kind: 'number' },
];

const SORT_OPTIONS: Array<{ key: BulkProductSortKey; direction: BulkProductSortDirection; label: string }> = [
  { key: 'created_at', direction: 'desc', label: 'Date Created: Newest first' },
  { key: 'created_at', direction: 'asc', label: 'Date Created: Oldest first' },
  { key: 'name', direction: 'asc', label: 'Product Name: A to Z' },
  { key: 'name', direction: 'desc', label: 'Product Name: Z to A' },
  { key: 'inventory', direction: 'desc', label: 'Inventory Level: High to low' },
  { key: 'inventory', direction: 'asc', label: 'Inventory Level: Low to high' },
  { key: 'rrp', direction: 'desc', label: 'RRP: High to low' },
  { key: 'rrp', direction: 'asc', label: 'RRP: Low to high' },
  { key: 'cost', direction: 'desc', label: 'Cost: High to low' },
  { key: 'cost', direction: 'asc', label: 'Cost: Low to high' },
];

function filterDefaults(field: BulkProductFilterField): Pick<BulkProductFilter, 'operator' | 'value'> {
  const kind = FILTER_FIELDS.find(candidate => candidate.id === field)?.kind;
  if (kind === 'boolean') return { operator: '=', value: '1' };
  if (kind === 'text') return { operator: 'contains', value: '' };
  return { operator: '>=', value: '' };
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function EditableChoicePicker({ value, options, onChange, allowCustom, style, label }: {
  value: string;
  options: LookupOption[];
  onChange: (value: string) => void;
  allowCustom: boolean;
  style: CSSProperties;
  label: string;
}) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filterChoices, setFilterChoices] = useState(false);
  const selectedName = allowCustom ? value : options.find(option => String(option.id) === value)?.name ?? '';
  const shownValue = open ? query : selectedName;
  const filteredOptions = filterChoices
    ? options.filter(option => option.name.toLowerCase().includes(query.trim().toLowerCase()))
    : options;
  const bounds = inputRef.current?.getBoundingClientRect();

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!inputRef.current?.parentElement?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const reposition = () => setOpen(false);
    document.addEventListener('pointerdown', close);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  const openChoices = () => {
    setQuery(selectedName);
    setFilterChoices(false);
    setOpen(true);
  };
  const selectOption = (option: LookupOption) => {
    onChange(allowCustom ? option.name : String(option.id));
    setQuery(option.name);
    setOpen(false);
    inputRef.current?.focus();
  };

  return <div style={{ position: 'relative', width: '100%' }}>
    <input
      ref={inputRef}
      role="combobox"
      aria-label={label}
      aria-expanded={open}
      aria-controls={listboxId}
      autoComplete="off"
      value={shownValue}
      onChange={event => {
        const next = event.target.value;
        setQuery(next);
        setFilterChoices(true);
        setOpen(true);
        if (allowCustom) onChange(next);
        else onChange(String(options.find(option => option.name.toLowerCase() === next.trim().toLowerCase())?.id ?? ''));
      }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); openChoices(); }
        if (event.key === 'Escape') setOpen(false);
        if (event.key === 'Enter' && filteredOptions.length === 1) { event.preventDefault(); selectOption(filteredOptions[0]); }
      }}
      onBlur={() => {
        if (allowCustom) return;
        const exact = options.find(option => option.name.toLowerCase() === query.trim().toLowerCase());
        if (exact) onChange(String(exact.id));
        else setQuery(selectedName);
      }}
      style={{ ...style, paddingRight: 30 }}
    />
    <button
      type="button"
      title={`Show ${label.toLowerCase()} choices`}
      aria-label={`Show ${label.toLowerCase()} choices`}
      onPointerDown={event => event.stopPropagation()}
      onClick={() => open ? setOpen(false) : openChoices()}
      style={{ position: 'absolute', top: 1, right: 1, bottom: 1, width: 28, display: 'grid', placeItems: 'center', padding: 0, border: 0, borderLeft: '1px solid var(--sv-etch)', borderRadius: '0 3px 3px 0', background: 'var(--sv-bg-2)', color: 'var(--sv-text-dim)', cursor: 'pointer' }}
    ><ChevronDown size={14} /></button>
    {open && bounds && createPortal(
      <div ref={menuRef} id={listboxId} role="listbox" onPointerDown={event => event.stopPropagation()} style={{ position: 'fixed', left: bounds.left, top: bounds.bottom + 3, zIndex: 2000, width: Math.max(bounds.width, 180), maxHeight: 240, overflowY: 'auto', padding: 3, border: '1px solid var(--sv-etch)', borderRadius: 4, background: 'var(--sv-bg-1)', boxShadow: '0 10px 24px rgba(15,23,42,.18)' }}>
        {!allowCustom && <button type="button" role="option" aria-selected={!value} onPointerDown={event => { event.preventDefault(); selectOption({ id: '', name: 'None' }); }} style={{ width: '100%', padding: '6px 8px', border: 0, background: !value ? 'var(--sv-bg-2)' : 'transparent', color: 'var(--sv-text-main)', textAlign: 'left', fontSize: 12, cursor: 'pointer' }}>None</button>}
        {filteredOptions.map(option => <button key={option.id} type="button" role="option" aria-selected={allowCustom ? option.name === value : String(option.id) === value} onPointerDown={event => { event.preventDefault(); selectOption(option); }} style={{ width: '100%', padding: '6px 8px', border: 0, background: (allowCustom ? option.name === value : String(option.id) === value) ? 'var(--sv-bg-2)' : 'transparent', color: 'var(--sv-text-main)', textAlign: 'left', fontSize: 12, cursor: 'pointer' }}>{option.name}</button>)}
        {!filteredOptions.length && <div style={{ padding: '7px 8px', color: 'var(--sv-text-dim)', fontSize: 12 }}>No matching choices</div>}
      </div>,
      document.body,
    )}
  </div>;
}

function blankVariant(baseSku = ''): VariantDraft {
  return {
    clientId: newId('variant'), option1Value: '', option2Value: '', option3Value: '', sku: baseSku, barcode: '',
    cost_aud: '', price_rrp: '', price_wholesale: '', price_rrp_sale: '', discount_start_date: '', discount_end_date: '',
    weight_kg: '', cost_foreign: '', foreignCosts: {}, foreignCostsParseFailed: false, foreignCostsEdited: false, locationStock: {}, locationEdits: {}, is_active: 1,
  };
}

function blankProduct(): ProductDraft {
  return {
    clientId: newId('product'), name: '', base_sku: '', description: '', product_type: '', brand: '', tags: '', category: '',
    subcategory: '', style_code: '', is_active: 1, is_stock_item: 1, is_online: 1, supplier_contact_id: '', website_title: '',
    allow_indent_wholesale: 0, optionSets: [{ name: '', values: '' }], variants: [blankVariant()],
  };
}

function optionSetsFromVariants(variants: Record<string, unknown>[]): ProductOptionSet[] {
  if (variants.length === 1
    && ['', 'default'].includes(String(variants[0].option1_value ?? '').trim().toLowerCase())
    && !String(variants[0].option2_value ?? '').trim()
    && !String(variants[0].option3_value ?? '').trim()) {
    return [{ name: '', values: '' }];
  }
  const sets: ProductOptionSet[] = [];
  for (let index = 1; index <= 3; index += 1) {
    const name = String(variants.find(variant => variant[`option${index}_name`])?.[`option${index}_name`] ?? '');
    const values = [...new Set(variants.map(variant => String(variant[`option${index}_value`] ?? '')).filter(Boolean))];
    if (name || values.length) sets.push({ name, values: values.join(', ') });
  }
  return sets.length ? sets : [{ name: '', values: '' }];
}

function productFromApi(product: Record<string, any>): ProductDraft {
  const apiVariants = Array.isArray(product.variants) ? product.variants : [];
  return {
    clientId: `product-${product.product_id}`, productId: String(product.product_id), name: String(product.name ?? ''),
    base_sku: String(product.base_sku ?? ''), description: String(product.description ?? ''), product_type: String(product.product_type ?? ''),
    brand: String(product.brand ?? ''), tags: String(product.tags ?? ''), category: String(product.category ?? ''),
    subcategory: String(product.subcategory ?? ''), style_code: String(product.style_code ?? ''), is_active: Number(product.is_active ?? 1),
    is_stock_item: Number(product.is_stock_item ?? 1), is_online: Number(product.is_online ?? 1),
    supplier_contact_id: product.supplier_contact_id ? Number(product.supplier_contact_id) : '', website_title: String(product.website_title ?? ''),
    allow_indent_wholesale: Number(product.allow_indent_wholesale ?? 0), optionSets: optionSetsFromVariants(apiVariants),
    variants: apiVariants.map((variant: Record<string, any>) => {
      let foreignCosts: Record<string, string> = {};
      let foreignCostsParseFailed = false;
      try {
        const parsed = JSON.parse(String(variant.cost_foreign ?? '{}'));
        if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') foreignCosts = Object.fromEntries(Object.entries(parsed).map(([currency, amount]) => [currency, String(amount)]));
        else foreignCostsParseFailed = true;
      } catch { foreignCostsParseFailed = true; }
      const locationStock = Object.fromEntries((Array.isArray(variant.location_stock) ? variant.location_stock : []).map((stock: Record<string, any>) => [String(stock.location_id), {
        quantity: stock.qty_on_hand == null ? '' : String(stock.qty_on_hand),
        minQty: stock.min_qty == null ? '' : String(stock.min_qty),
        reorderQty: stock.reorder_qty == null ? '' : String(stock.reorder_qty),
        zone: String(stock.zone ?? ''),
        bin: String(stock.bin ?? ''),
      }]));
      return {
      clientId: `variant-${variant.variant_id}`, variantId: String(variant.variant_id), option1Value: String(variant.option1_value ?? ''),
      option2Value: String(variant.option2_value ?? ''), option3Value: String(variant.option3_value ?? ''), sku: String(variant.sku ?? ''),
      barcode: String(variant.barcode ?? ''), cost_aud: variant.cost_aud == null ? '' : String(variant.cost_aud),
      price_rrp: variant.price_rrp == null ? '' : String(variant.price_rrp), price_wholesale: variant.price_wholesale == null ? '' : String(variant.price_wholesale),
      price_rrp_sale: variant.price_rrp_sale == null ? '' : String(variant.price_rrp_sale),
      discount_start_date: variant.discount_start_date ? String(variant.discount_start_date).slice(0, 10) : '',
      discount_end_date: variant.discount_end_date ? String(variant.discount_end_date).slice(0, 10) : '',
      weight_kg: variant.weight_kg == null ? '' : String(variant.weight_kg), cost_foreign: String(variant.cost_foreign ?? ''), foreignCosts, foreignCostsParseFailed, foreignCostsEdited: false,
      locationStock, locationEdits: {},
      is_active: Number(variant.is_active ?? 1),
      };
    }),
  };
}

function variantLabel(variant: VariantDraft): string {
  return [variant.option1Value, variant.option2Value, variant.option3Value].filter(Boolean).join(' / ') || 'Default';
}

function isDefaultVariant(variant: VariantDraft): boolean {
  return ['', 'default'].includes(variant.option1Value.trim().toLowerCase()) && !variant.option2Value && !variant.option3Value;
}

function hasGeneratedVariants(product: ProductDraft): boolean {
  return product.variants.length > 1 || product.variants.some(variant => !isDefaultVariant(variant));
}

function updateVariantDraftField(variant: VariantDraft, fieldId: string, value: unknown): VariantDraft {
  const currencyMatch = fieldId.match(/^foreign_cost_([A-Z]{3})$/);
  if (currencyMatch) return { ...variant, foreignCosts: { ...variant.foreignCosts, [currencyMatch[1]]: String(value) }, foreignCostsEdited: true };
  const locationMatch = fieldId.match(/^location_(\d+)_(soh|min_qty|reorder_qty|zone|bin)$/);
  if (locationMatch) {
    const [, locationId, rawField] = locationMatch;
    const locationField = ({ soh: 'quantity', min_qty: 'minQty', reorder_qty: 'reorderQty', zone: 'zone', bin: 'bin' } as const)[rawField as 'soh' | 'min_qty' | 'reorder_qty' | 'zone' | 'bin'];
    const current = variant.locationStock[locationId] ?? { quantity: '', minQty: '', reorderQty: '', zone: '', bin: '' };
    return {
      ...variant,
      locationStock: { ...variant.locationStock, [locationId]: { ...current, [locationField]: String(value) } },
      locationEdits: { ...variant.locationEdits, [fieldId]: true },
    };
  }
  const dataField = fieldId === 'is_active_variant' ? 'is_active' : fieldId;
  return { ...variant, [dataField]: value };
}

function locationStockChanges(variant: VariantDraft) {
  const changes = new Map<number, Record<string, unknown>>();
  for (const fieldId of Object.keys(variant.locationEdits)) {
    const match = fieldId.match(/^location_(\d+)_(soh|min_qty|reorder_qty|zone|bin)$/);
    if (!match) continue;
    const locationId = Number(match[1]);
    const rawField = match[2] as 'soh' | 'min_qty' | 'reorder_qty' | 'zone' | 'bin';
    const locationField = ({ soh: 'quantity', min_qty: 'minQty', reorder_qty: 'reorderQty', zone: 'zone', bin: 'bin' } as const)[rawField];
    const change = changes.get(locationId) ?? { locationId };
    change[locationField] = variant.locationStock[String(locationId)]?.[locationField] ?? '';
    changes.set(locationId, change);
  }
  return [...changes.values()];
}

function serializedForeignCosts(variant: VariantDraft): string | null | undefined {
  if (variant.foreignCostsParseFailed && !variant.foreignCostsEdited) return undefined;
  const costs = Object.fromEntries(Object.entries(variant.foreignCosts).filter(([, amount]) => amount !== ''));
  return Object.keys(costs).length ? JSON.stringify(costs) : null;
}

export function BulkAddEditProductsView({ businessId }: { businessId: string }) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [brands, setBrands] = useState<LookupOption[]>([]);
  const [suppliers, setSuppliers] = useState<LookupOption[]>([]);
  const [locations, setLocations] = useState<LookupOption[]>([]);
  const [serverProducts, setServerProducts] = useState<ProductDraft[]>([]);
  const [dirtyProducts, setDirtyProducts] = useState<Record<string, ProductDraft>>({});
  const [newProducts, setNewProducts] = useState<ProductDraft[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presets, setPresets] = useState<BulkProductPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState('');
  const [manageVariantsProductId, setManageVariantsProductId] = useState<string | null>(null);
  const [configurationLoaded, setConfigurationLoaded] = useState(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const [query, setQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [sortKey, setSortKey] = useState<BulkProductSortKey>(DEFAULT_BULK_PRODUCT_WORKSPACE.sortKey);
  const [sortDirection, setSortDirection] = useState<BulkProductSortDirection>(DEFAULT_BULK_PRODUCT_WORKSPACE.sortDirection);
  const [filterJoin, setFilterJoin] = useState<'and' | 'or'>(DEFAULT_BULK_PRODUCT_WORKSPACE.filterJoin);
  const [advancedFilters, setAdvancedFilters] = useState<BulkProductFilter[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [fill, setFill] = useState<FillState | null>(null);
  const fillDragCandidateRef = useRef<FillDragCandidate | null>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  useTableArrowScroll(bodyScrollRef);

  const productSettings = useMemo(() => parseProductSettings(settings), [settings]);
  const availableFields = useMemo(() => {
    const baseFields = enabledBulkProductFields(productSettings, settings.use_foreign_currencies !== 'no');
    const currencyFields: BulkProductFieldDefinition[] = settings.use_foreign_currencies !== 'no'
      ? FOREIGN_CURRENCIES.map(currencyCode => ({ id: `foreign_cost_${currencyCode}`, label: `Cost ${currencyCode} (GST Exc)`, owner: 'variant', editor: 'number', width: 150, fillDown: true, currencyCode }))
      : [];
    const locationFields: BulkProductFieldDefinition[] = locations.flatMap(location => {
      const fields: BulkProductFieldDefinition[] = [];
      if (productSettings.allowOpeningStock) fields.push({ id: `location_${location.id}_soh`, label: `${location.name} SOH`, owner: 'variant', editor: 'number', width: 125, fillDown: true, locationId: Number(location.id), locationField: 'quantity' });
      if (productSettings.showReplenishmentQuantities) fields.push(
        { id: `location_${location.id}_min_qty`, label: `${location.name} Min Qty`, owner: 'variant', editor: 'number', width: 145, fillDown: true, locationId: Number(location.id), locationField: 'minQty' },
        { id: `location_${location.id}_reorder_qty`, label: `${location.name} Reorder Point`, owner: 'variant', editor: 'number', width: 165, fillDown: true, locationId: Number(location.id), locationField: 'reorderQty' },
      );
      if (settings.use_zones_bins === 'yes') fields.push(
        { id: `location_${location.id}_zone`, label: `${location.name} Zone`, owner: 'variant', editor: 'text', width: 130, fillDown: true, locationId: Number(location.id), locationField: 'zone' },
        { id: `location_${location.id}_bin`, label: `${location.name} Bin`, owner: 'variant', editor: 'text', width: 130, fillDown: true, locationId: Number(location.id), locationField: 'bin' },
      );
      return fields;
    });
    return [...baseFields, ...currencyFields, ...locationFields];
  }, [locations, productSettings, settings.use_foreign_currencies, settings.use_zones_bins]);
  const fields = useMemo(
    () => selectedFields.map(id => availableFields.find(field => field.id === id)).filter((field): field is BulkProductFieldDefinition => Boolean(field)),
    [availableFields, selectedFields],
  );
  const displayedProducts = useMemo(() => [
    ...newProducts,
    ...serverProducts.map(product => dirtyProducts[product.clientId] ?? product),
  ], [dirtyProducts, newProducts, serverProducts]);
  const dirtyCount = newProducts.length + Object.keys(dirtyProducts).length;
  const pendingProducts = useMemo(() => [...newProducts, ...Object.values(dirtyProducts)], [dirtyProducts, newProducts]);
  const hasRequiredFieldErrors = pendingProducts.some(product =>
    !product.name.trim() || !product.base_sku.trim() || !product.variants.length || product.variants.some(variant => !variant.sku.trim()),
  );
  const storageKey = `solvantis:bulk-add-edit:fields:v1:${businessId}`;

  useEffect(() => {
    Promise.all([
      fetch('/api/ims/settings').then(async response => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Product settings could not be loaded.');
        return result;
      }),
      fetch('/api/ims/brands').then(async response => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Brands could not be loaded.');
        return result;
      }),
      fetch('/api/ims/contacts?type=supplier&active=1').then(async response => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Suppliers could not be loaded.');
        return result;
      }),
      fetch('/api/ims/locations').then(async response => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Locations could not be loaded.');
        return result;
      }),
    ]).then(([settingsResult, brandsResult, suppliersResult, locationsResult]) => {
      setSettings(settingsResult.data ?? {});
      setBrands(brandsResult.data ?? []);
      setSuppliers(suppliersResult.data ?? []);
      setLocations((locationsResult.data ?? []).filter((location: any) => Number(location.is_active ?? 1) !== 0));
      setConfigurationLoaded(true);
    }).catch(error => {
      setSelectedFields(sanitizeBulkProductFieldSelection(null, availableFields));
      setMessage(error instanceof Error ? error.message : 'Product options could not be loaded.');
    });
  }, []);

  useEffect(() => {
    if (!configurationLoaded) return;
    let stored: unknown;
    try { stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null'); } catch { stored = null; }
    setSelectedFields(sanitizeBulkProductFieldSelection(stored, availableFields));
  }, [availableFields, configurationLoaded, storageKey]);

  useEffect(() => {
    if (configurationLoaded && selectedFields.length) localStorage.setItem(storageKey, JSON.stringify(selectedFields));
  }, [configurationLoaded, selectedFields, storageKey]);

  const load = async () => {
    setLoading(true);
    setLoadError('');
    const params = new URLSearchParams({ page: String(page) });
    if (query.trim()) params.set('q', query.trim());
    if (brandFilter) params.set('brand', brandFilter);
    if (supplierFilter) params.set('supplier', supplierFilter);
    try {
      const response = await fetch(`/api/ims/products/bulk-add-edit?${params}`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Products could not be loaded.');
      setServerProducts(result.products.map(productFromApi));
      setTotal(Number(result.total ?? 0));
    } catch (error) {
      setServerProducts([]);
      setTotal(0);
      setLoadError(error instanceof Error ? error.message : 'Products could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [page, query, brandFilter, supplierFilter]);

  const mutateProduct = (clientId: string, mutate: (product: ProductDraft) => ProductDraft) => {
    const newIndex = newProducts.findIndex(product => product.clientId === clientId);
    if (newIndex >= 0) {
      setNewProducts(current => current.map(product => product.clientId === clientId ? mutate(product) : product));
      return;
    }
    const source = dirtyProducts[clientId] ?? serverProducts.find(product => product.clientId === clientId);
    if (source) setDirtyProducts(current => ({ ...current, [clientId]: mutate(source) }));
  };

  const updateProductField = (productClientId: string, fieldId: string, value: unknown) => {
    mutateProduct(productClientId, product => ({
      ...product,
      [fieldId]: value,
      variants: fieldId === 'base_sku' && product.variants.length === 1 && isDefaultVariant(product.variants[0])
        ? [{ ...product.variants[0], sku: String(value) }]
        : product.variants,
    }));
    setErrors(current => ({ ...current, [productClientId]: { ...current[productClientId], [fieldId]: '' } }));
  };

  const updateVariantField = (productClientId: string, variantClientId: string, fieldId: string, value: unknown) => {
    mutateProduct(productClientId, product => ({
      ...product,
      variants: product.variants.map(variant => variant.clientId === variantClientId ? updateVariantDraftField(variant, fieldId, value) : variant),
    }));
    setErrors(current => ({ ...current, [variantClientId]: { ...current[variantClientId], [fieldId]: '' } }));
  };

  const visibleRows = useMemo<VisibleRow[]>(() => displayedProducts.flatMap(product => {
    const rows: VisibleRow[] = [{ id: product.clientId, owner: 'product', productClientId: product.clientId }];
    if (!hasGeneratedVariants(product) && product.variants[0]) rows.push({
      id: product.variants[0].clientId, owner: 'variant' as const, productClientId: product.clientId, variantClientId: product.variants[0].clientId,
    });
    if (hasGeneratedVariants(product) && expanded.has(product.clientId)) rows.push(...product.variants.map(variant => ({
      id: variant.clientId, owner: 'variant' as const, productClientId: product.clientId, variantClientId: variant.clientId,
    })));
    return rows;
  }), [displayedProducts, expanded]);

  const applyFill = (state: FillState) => {
    const targets = bulkFillTargets(visibleRows, state.sourceRowId, state.targetRowId, state.owner);
    const targetsByProduct = new Map<string, Set<string>>();
    for (const row of targets) {
      const rowIds = targetsByProduct.get(row.productClientId) ?? new Set<string>();
      rowIds.add(row.variantClientId ?? row.id);
      targetsByProduct.set(row.productClientId, rowIds);
    }
    for (const [productClientId, rowIds] of targetsByProduct) {
      mutateProduct(productClientId, product => {
        if (state.owner === 'product') return { ...product, [state.fieldId]: state.value };
        return {
          ...product,
          variants: product.variants.map(variant => rowIds.has(variant.clientId) ? updateVariantDraftField(variant, state.fieldId, state.value) : variant),
        };
      });
      for (const rowId of rowIds) {
        setErrors(current => ({ ...current, [rowId]: { ...current[rowId], [state.fieldId]: '' } }));
      }
    }
  };

  const fillTargetIds = useMemo(() => new Set(
    fill ? bulkFillTargets(visibleRows, fill.sourceRowId, fill.targetRowId, fill.owner).map(row => row.id) : [],
  ), [fill, visibleRows]);

  useEffect(() => {
    const clearCandidate = () => { fillDragCandidateRef.current = null; };
    window.addEventListener('pointerup', clearCandidate);
    window.addEventListener('pointercancel', clearCandidate);
    return () => {
      window.removeEventListener('pointerup', clearCandidate);
      window.removeEventListener('pointercancel', clearCandidate);
    };
  }, []);

  useEffect(() => {
    if (!fill) return;
    const finish = () => { applyFill(fill); setFill(null); };
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setFill(null); };
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('keydown', cancel);
    return () => { window.removeEventListener('pointerup', finish); window.removeEventListener('keydown', cancel); };
  }, [fill, visibleRows]);

  useEffect(() => {
    if (!manageVariantsProductId) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setManageVariantsProductId(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [manageVariantsProductId]);

  const addProduct = () => {
    const product = blankProduct();
    setNewProducts(current => [product, ...current]);
  };

  const generateVariants = (product: ProductDraft) => {
    if (!product.base_sku.trim()) {
      setErrors(current => ({ ...current, [product.clientId]: { ...current[product.clientId], base_sku: 'Enter Product SKU before generating variants.' } }));
      return;
    }
    const result = reconcileVariantMatrix(product.base_sku, product.optionSets, product.variants, () => newId('variant'));
    mutateProduct(product.clientId, current => ({ ...current, variants: result.variants.map(variant => ({ ...blankVariant(), ...variant })) as VariantDraft[] }));
    if (result.variants.length > 1 || result.variants.some(variant => variant.option1Value || variant.option2Value || variant.option3Value)) {
      setExpanded(current => new Set(current).add(product.clientId));
    } else {
      setExpanded(current => { const next = new Set(current); next.delete(product.clientId); return next; });
    }
    if (result.unmatchedExisting.length) setMessage(`${result.unmatchedExisting.length} saved variant(s) no longer match the matrix and were kept.`);
  };

  const save = async () => {
    const products = [...newProducts, ...Object.values(dirtyProducts)];
    if (!products.length) return;
    setSaving(true);
    setMessage('');
    setErrors({});
    try {
      const response = await fetch('/api/ims/products/bulk-add-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestToken: crypto.randomUUID(), products: products.map(product => ({
          ...product,
          variants: product.variants.map(variant => ({
            ...variant,
            cost_foreign: serializedForeignCosts(variant),
            locationStock: locationStockChanges(variant),
            option1_name: product.optionSets[0]?.name ?? '', option1_value: variant.option1Value,
            option2_name: product.optionSets[1]?.name ?? '', option2_value: variant.option2Value,
            option3_name: product.optionSets[2]?.name ?? '', option3_value: variant.option3Value,
          })),
        })) }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        const nextErrors: Record<string, Record<string, string>> = {};
        for (const error of result.errors ?? []) nextErrors[error.clientId] = { ...nextErrors[error.clientId], [error.field]: error.message };
        setErrors(nextErrors);
        const firstError = result.errors?.[0];
        if (firstError) {
          const affectedProduct = products.find(product =>
            product.clientId === firstError.clientId || product.variants.some(variant => variant.clientId === firstError.clientId),
          );
          if (affectedProduct) setExpanded(current => new Set(current).add(affectedProduct.clientId));
          if (affectedProduct && firstError.field === 'sku') setManageVariantsProductId(affectedProduct.clientId);
          window.requestAnimationFrame(() => {
            const cell = document.querySelector<HTMLElement>(`[data-row-id="${firstError.clientId}"][data-field-id="${firstError.field}"]`);
            cell?.scrollIntoView({ block: 'center', inline: 'center' });
            cell?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
          });
        }
        throw new Error(result.error || 'No products were saved.');
      }
      setMessage(`${result.created} product(s) created and ${result.updated} product(s) updated.`);
      setNewProducts([]);
      setDirtyProducts({});
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No products were saved.');
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setNewProducts([]);
    setDirtyProducts({});
    setErrors({});
    setMessage('Changes discarded.');
  };

  const productsWithVariants = displayedProducts.filter(hasGeneratedVariants);
  const managedProduct = displayedProducts.find(product => product.clientId === manageVariantsProductId) ?? null;
  const currencyFields = availableFields.filter(field => field.currencyCode);
  const locationFields = availableFields.filter(field => field.locationId);
  const standardFields = availableFields.filter(field => !field.currencyCode && !field.locationId);
  const selectedCurrencyFields = currencyFields.filter(field => selectedFields.includes(field.id));
  const setFieldGroup = (fieldIds: string[], checked: boolean) => setSelectedFields(current => sanitizeBulkProductFieldSelection(
    checked ? [...current, ...fieldIds] : current.filter(id => !fieldIds.includes(id)),
    availableFields,
  ));
  const totalWidth = 44 + 180 + fields.reduce((sum, field) => sum + field.width, 0);
  const renderColGroup = () => <colgroup><col style={{ width: 44 }} /><col style={{ width: 180 }} />{fields.map(field => <col key={field.id} style={{ width: field.width }} />)}</colgroup>;

  const valueFor = (product: ProductDraft, variant: VariantDraft | undefined, field: BulkProductFieldDefinition) => {
    if (field.owner === 'product') return product[field.id] ?? '';
    if (field.currencyCode) return variant?.foreignCosts[field.currencyCode] ?? '';
    if (field.locationId && field.locationField) return variant?.locationStock[String(field.locationId)]?.[field.locationField] ?? '';
    const dataField = field.id === 'is_active_variant' ? 'is_active' : field.id;
    return variant?.[dataField] ?? '';
  };

  const renderEditor = (product: ProductDraft, variant: VariantDraft | undefined, field: BulkProductFieldDefinition) => {
    const rowId = variant?.clientId ?? product.clientId;
    const value = valueFor(product, variant, field);
    const update = (next: unknown) => variant
      ? updateVariantField(product.clientId, variant.clientId, field.id, next)
      : updateProductField(product.clientId, field.id, next);
    const error = errors[rowId]?.[field.id];
    const isFillTarget = Boolean(fill && fill.fieldId === field.id && fill.owner === field.owner && fillTargetIds.has(rowId));
    const common = { value: String(value ?? ''), onChange: (event: any) => update(event.target.value), style: { ...inputStyle, borderColor: error ? 'var(--sv-red)' : isFillTarget ? 'var(--sv-action)' : 'var(--sv-etch)', background: isFillTarget ? 'color-mix(in srgb, var(--sv-action) 16%, var(--sv-bg-1))' : 'var(--sv-bg-1)', transition: 'background-color 100ms ease, border-color 100ms ease, box-shadow 100ms ease', boxShadow: isFillTarget ? 'inset 0 0 0 1px var(--sv-action)' : 'none' }, 'aria-invalid': Boolean(error), title: error || field.label };
    let editor;
    if (field.editor === 'boolean') {
      editor = <input type="checkbox" checked={Number(value) === 1} onChange={event => update(event.target.checked ? 1 : 0)} aria-label={field.label} />;
    } else if (field.id === 'brand') {
      editor = <EditableChoicePicker value={String(value ?? '')} options={brands} onChange={update} allowCustom style={common.style} label={field.label} />;
    } else if (field.id === 'supplier_contact_id') {
      editor = <EditableChoicePicker value={String(value ?? '')} options={suppliers} onChange={update} allowCustom={false} style={common.style} label={field.label} />;
    } else if (field.editor === 'textarea') {
      editor = <textarea {...common} rows={2} style={{ ...common.style, resize: 'vertical' }} />;
    } else {
      editor = <input {...common} type={field.editor === 'number' ? 'number' : field.editor === 'date' ? 'date' : 'text'} min={field.editor === 'number' ? 0 : undefined} step={field.editor === 'number' ? 'any' : undefined} />;
    }
    return (
      <div
        data-row-id={rowId}
        data-field-id={field.id}
        data-fill-active={fill?.fieldId === field.id && fill?.owner === field.owner ? 'true' : undefined}
        onPointerEnter={() => fill && fill.fieldId === field.id && fill.owner === field.owner && setFill({ ...fill, targetRowId: rowId })}
        onPointerDown={event => {
          if (!field.fillDown || event.button !== 0) return;
          const target = event.target as HTMLElement;
          const selectableControl = field.editor === 'select' || target instanceof HTMLSelectElement || target instanceof HTMLInputElement && Boolean(target.list);
          if (selectableControl) {
            const bounds = target.getBoundingClientRect();
            if (event.clientX >= bounds.right - 30) return;
          }
          fillDragCandidateRef.current = { fieldId: field.id, owner: field.owner, sourceRowId: rowId, targetRowId: rowId, value, startX: event.clientX, startY: event.clientY };
        }}
        onPointerMove={event => {
          const candidate = fillDragCandidateRef.current;
          if (!candidate || candidate.fieldId !== field.id || candidate.sourceRowId !== rowId || fill) return;
          if (Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY) < 5) return;
          event.preventDefault();
          setFill(candidate);
        }}
        style={{ position: 'relative', minHeight: 30, display: 'flex', alignItems: 'center', justifyContent: field.editor === 'boolean' ? 'center' : 'stretch', borderRadius: 4, background: isFillTarget ? 'color-mix(in srgb, var(--sv-action) 18%, transparent)' : undefined, boxShadow: isFillTarget ? '0 0 0 2px color-mix(in srgb, var(--sv-action) 45%, transparent)' : 'none', transition: 'background-color 100ms ease, box-shadow 100ms ease' }}
      >
        {editor}
        {field.fillDown && <span aria-hidden="true" title={`Drag anywhere in this field to copy ${field.label}`} style={{ position: 'absolute', left: 5, bottom: 1, width: 14, height: 2, borderRadius: 2, background: isFillTarget ? 'var(--sv-action)' : 'color-mix(in srgb, var(--sv-action) 45%, transparent)', pointerEvents: 'none' }} />}
        {error && <span style={{ position: 'absolute', left: 2, top: '100%', zIndex: 8, background: 'var(--sv-red)', color: '#fff', fontSize: 10, padding: '2px 5px', whiteSpace: 'nowrap' }}>{error}</span>}
      </div>
    );
  };

  const renderDataRow = (product: ProductDraft, variant?: VariantDraft) => {
    const defaultVariant = !variant && !hasGeneratedVariants(product) ? product.variants[0] : undefined;
    return (
      <tr key={variant?.clientId ?? product.clientId} style={{ background: variant ? 'var(--sv-bg-2)' : 'var(--sv-bg-1)' }}>
        <td style={{ position: 'sticky', left: 0, zIndex: 3, background: variant ? 'var(--sv-bg-2)' : 'var(--sv-bg-1)', padding: 4, borderBottom: '1px solid var(--sv-etch)', textAlign: 'center' }}>
          {!variant && hasGeneratedVariants(product) && <button type="button" aria-label={`${expanded.has(product.clientId) ? 'Collapse' : 'Expand'} ${product.name || 'new product'} variants`} onClick={() => setExpanded(current => { const next = new Set(current); next.has(product.clientId) ? next.delete(product.clientId) : next.add(product.clientId); return next; })} style={{ ...buttonStyle, padding: 4, border: 0 }}>
            {expanded.has(product.clientId) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>}
        </td>
        <td style={{ position: 'sticky', left: 44, zIndex: 2, background: variant ? 'var(--sv-bg-2)' : 'var(--sv-bg-1)', padding: '5px 8px', borderBottom: '1px solid var(--sv-etch)', boxShadow: '3px 0 5px rgba(15,23,42,.06)', fontSize: 11, fontWeight: 650, color: 'var(--sv-text-dim)' }}>
          {variant ? variantLabel(variant) : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}><span>{product.productId ? 'Existing product' : 'New product'}</span><button type="button" title="Manage variants" aria-label={`Manage variants for ${product.name || 'new product'}`} onClick={() => setManageVariantsProductId(product.clientId)} style={{ ...buttonStyle, padding: '4px 6px' }}><Settings2 size={14} /> Variants</button></div>}
        </td>
        {fields.map(field => <td key={field.id} style={{ padding: 3, borderBottom: '1px solid var(--sv-etch)', verticalAlign: 'top' }}>{field.owner === 'product' && !variant ? renderEditor(product, undefined, field) : field.owner === 'variant' && (variant || defaultVariant) ? renderEditor(product, variant ?? defaultVariant, field) : null}</td>)}
      </tr>
    );
  };

  return (
    <div style={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <div style={{ marginBottom: 14 }}>
        <div><h2 style={{ margin: 0, fontSize: 19, color: 'var(--sv-text-strong)' }}>Bulk Add/Edit Products</h2><div style={{ marginTop: 3, color: 'var(--sv-text-dim)', fontSize: 12 }}>Catalogue and variant fields across all locations</div></div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Search name, SKU, barcode or brand" style={{ ...inputStyle, width: 270 }} />
        <select value={brandFilter} onChange={event => { setBrandFilter(event.target.value); setPage(1); }} style={{ ...inputStyle, width: 170 }}><option value="">All brands</option>{brands.map(brand => <option key={brand.id} value={brand.name}>{brand.name}</option>)}</select>
        <select value={supplierFilter} onChange={event => { setSupplierFilter(event.target.value); setPage(1); }} style={{ ...inputStyle, width: 190 }}><option value="">All suppliers</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select>
        <div style={{ display: 'inline-flex', gap: 2 }}>
          <button type="button" title="Expand all variants" aria-label="Expand all variants" disabled={!productsWithVariants.length} onClick={() => setExpanded(new Set(productsWithVariants.map(product => product.clientId)))} style={{ ...buttonStyle, padding: '5px 7px', opacity: productsWithVariants.length ? 1 : .5 }}><ChevronsUpDown size={14} /> Expand all</button>
          <button type="button" title="Collapse all variants" aria-label="Collapse all variants" disabled={!expanded.size} onClick={() => setExpanded(new Set())} style={{ ...buttonStyle, padding: '5px 7px', opacity: expanded.size ? 1 : .5 }}><ChevronsDownUp size={14} /> Collapse all</button>
        </div>
        <span style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>{total} existing products{newProducts.length ? ` + ${newProducts.length} new` : ''}</span>
      </div>
      {message && <div role="status" style={{ marginBottom: 10, padding: '8px 10px', border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-2)', color: 'var(--sv-text-main)', fontSize: 12 }}>{message}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 7, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6, paddingLeft: 44 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" onClick={addProduct} style={buttonStyle}><Plus size={15} /> Add New Products</button>
          <button type="button" onClick={() => {
            const generated = populateBlankProductSkus(displayedProducts.map(product => ({ clientId: product.clientId, brand: product.brand, baseSku: product.base_sku })));
            generated.forEach(row => { if (row.baseSku !== displayedProducts.find(product => product.clientId === row.clientId)?.base_sku) updateProductField(String(row.clientId), 'base_sku', row.baseSku ?? ''); });
          }} style={buttonStyle}><Sparkles size={15} /> Auto Generate Product SKUs</button>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <button type="button" aria-expanded={fieldsOpen} onClick={() => setFieldsOpen(open => !open)} style={buttonStyle}><Columns3 size={15} /> Add fields</button>
          {fieldsOpen && <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 5px)', zIndex: 20, width: 330, maxHeight: 520, overflowY: 'auto', padding: 10, background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 6, boxShadow: '0 12px 28px rgba(15,23,42,.16)' }}>
            {(['product', 'variant'] as const).map(owner => <div key={owner}><div style={{ margin: '7px 4px 4px', fontSize: 10, fontWeight: 750, color: 'var(--sv-text-dim)', textTransform: 'uppercase' }}>{owner} fields</div>{standardFields.filter(field => field.owner === owner).map(field => <label key={field.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', fontSize: 12 }}><input type="checkbox" disabled={field.required} checked={selectedFields.includes(field.id)} onChange={event => setSelectedFields(current => sanitizeBulkProductFieldSelection(event.target.checked ? [...current, field.id] : current.filter(id => id !== field.id), availableFields))} />{field.label}</label>)}</div>)}
            {currencyFields.length > 0 && <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--sv-etch)' }}>
              <div style={{ margin: '0 4px 6px', fontSize: 10, fontWeight: 750, color: 'var(--sv-text-dim)', textTransform: 'uppercase' }}>Currency costs</div>
              <select aria-label="Add currency cost" value="" onChange={event => { if (event.target.value) setFieldGroup([event.target.value], true); }} style={{ ...inputStyle, marginBottom: selectedCurrencyFields.length ? 5 : 0 }}><option value="">Add a currency...</option>{currencyFields.filter(field => !selectedFields.includes(field.id)).map(field => <option key={field.id} value={field.id}>{field.currencyCode}</option>)}</select>
              {selectedCurrencyFields.map(field => <label key={field.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', fontSize: 12 }}><input type="checkbox" checked onChange={() => setFieldGroup([field.id], false)} />{field.label}</label>)}
            </div>}
            {locationFields.length > 0 && <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--sv-etch)' }}>
              <div style={{ margin: '0 4px 6px', fontSize: 10, fontWeight: 750, color: 'var(--sv-text-dim)', textTransform: 'uppercase' }}>Branch Level Variables</div>
              {([
                ['SOH at every branch', locationFields.filter(field => field.locationField === 'quantity').map(field => field.id)],
                ['Min Qty', locationFields.filter(field => field.locationField === 'minQty').map(field => field.id)],
                ['Reorder Point', locationFields.filter(field => field.locationField === 'reorderQty').map(field => field.id)],
                ['Zones / Bins', locationFields.filter(field => field.locationField === 'zone' || field.locationField === 'bin').map(field => field.id)],
              ] as Array<[string, string[]]>).filter(([, fieldIds]) => fieldIds.length).map(([label, fieldIds]) => <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', fontSize: 12 }}><input type="checkbox" checked={fieldIds.every(id => selectedFields.includes(id))} onChange={event => setFieldGroup(fieldIds, event.target.checked)} />{label}</label>)}
            </div>}
          </div>}
        </div>
        <button type="button" disabled={!dirtyCount || saving} onClick={discard} style={{ ...buttonStyle, opacity: !dirtyCount || saving ? .5 : 1 }}><Trash2 size={15} /> Discard</button>
        <button type="button" title={hasRequiredFieldErrors ? 'Enter Product Name, Product SKU and Variant SKU for every changed product.' : 'Save all changed products'} disabled={!dirtyCount || saving || hasRequiredFieldErrors} onClick={() => void save()} style={{ ...buttonStyle, borderColor: 'var(--sv-action)', background: 'var(--sv-action)', color: '#fff', opacity: !dirtyCount || saving || hasRequiredFieldErrors ? .5 : 1 }}><Save size={15} /> {saving ? 'Saving...' : `Save${dirtyCount ? ` (${dirtyCount})` : ''}`}</button>
        </div>
      </div>

      <div style={{ border: '1px solid var(--sv-etch)', minWidth: 0 }}>
        <div ref={headerScrollRef} style={{ position: 'sticky', top: 0, zIndex: 10, overflow: 'hidden', background: 'var(--sv-bg-2)' }}>
          <table style={{ width: totalWidth, tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }}>{renderColGroup()}<thead><tr><th style={{ position: 'sticky', left: 0, zIndex: 12, background: 'var(--sv-bg-2)', borderBottom: '1px solid var(--sv-etch)', height: 34 }} /><th style={{ position: 'sticky', left: 44, zIndex: 11, background: 'var(--sv-bg-2)', borderBottom: '1px solid var(--sv-etch)', boxShadow: '3px 0 5px rgba(15,23,42,.06)', textAlign: 'left', padding: '0 8px', fontSize: 11 }}>Row</th>{fields.map(field => <th key={field.id} style={{ borderBottom: '1px solid var(--sv-etch)', textAlign: 'left', padding: '0 7px', fontSize: 11, color: 'var(--sv-text-dim)' }}>{field.label}</th>)}</tr></thead></table>
        </div>
        <div ref={bodyScrollRef} className="ims-sticky-table ims-sticky-table--self-scroll bulk-add-edit-products-scroll" tabIndex={0} role="region" aria-label="Bulk Add/Edit Products table. Use Left and Right arrows to scroll columns and Up and Down arrows to scroll the page." onScroll={event => { if (headerScrollRef.current) headerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft; }} style={{ overflowX: 'auto', overflowY: 'hidden', minWidth: 0 }}>
          <table style={{ width: totalWidth, tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }}>{renderColGroup()}<tbody>
            {!loadError && displayedProducts.map(product => <Fragment key={product.clientId}>
              {renderDataRow(product)}
              {hasGeneratedVariants(product) && expanded.has(product.clientId) && product.variants.map(variant => renderDataRow(product, variant))}
            </Fragment>)}
            {!loading && loadError && <tr><td role="alert" colSpan={fields.length + 2} style={{ padding: 28, textAlign: 'center', color: 'var(--sv-danger, #b42318)', fontSize: 13 }}>{loadError}</td></tr>}
            {!loading && !loadError && !displayedProducts.length && <tr><td colSpan={fields.length + 2} style={{ padding: 28, textAlign: 'center', color: 'var(--sv-text-dim)', fontSize: 13 }}>No products match these filters. Use Add New Products to begin a new batch.</td></tr>}
            {loading && <tr><td colSpan={fields.length + 2} style={{ padding: 28, textAlign: 'center', color: 'var(--sv-text-dim)', fontSize: 13 }}>Loading products...</td></tr>}
          </tbody></table>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 10 }}><button type="button" disabled={page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))} style={{ ...buttonStyle, opacity: page <= 1 ? .5 : 1 }}>Previous</button><span style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>Page {page} of {Math.max(1, Math.ceil(total / 50))}</span><button type="button" disabled={page * 50 >= total} onClick={() => setPage(current => current + 1)} style={{ ...buttonStyle, opacity: page * 50 >= total ? .5 : 1 }}>Next</button></div>

      {managedProduct && <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setManageVariantsProductId(null); }} style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(15, 23, 42, .48)' }}>
        <div role="dialog" aria-modal="true" aria-labelledby="bulk-variants-title" style={{ width: 'min(720px, 100%)', maxHeight: 'min(720px, calc(100vh - 40px))', overflowY: 'auto', background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 8, boxShadow: '0 24px 60px rgba(15,23,42,.24)' }}>
          <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', background: 'var(--sv-bg-1)', borderBottom: '1px solid var(--sv-etch)' }}>
            <div><h3 id="bulk-variants-title" style={{ margin: 0, fontSize: 16, color: 'var(--sv-text-strong)' }}>Manage variants</h3><div style={{ marginTop: 2, fontSize: 12, color: 'var(--sv-text-dim)' }}>{managedProduct.name || 'New product'}</div></div>
            <button type="button" title="Close" aria-label="Close variants" onClick={() => setManageVariantsProductId(null)} style={{ ...buttonStyle, padding: 5 }}><X size={16} /></button>
          </div>
          <div style={{ padding: 14 }}>
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(100px, 160px) minmax(180px, 1fr) 30px', gap: 6, padding: '0 2px', color: 'var(--sv-text-dim)', fontSize: 11, fontWeight: 750 }}><span>Variant name</span><span>Variant values</span><span /></div>
              {managedProduct.optionSets.map((option, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: 'minmax(100px, 160px) minmax(180px, 1fr) 30px', gap: 6, alignItems: 'center' }}>
                <input aria-label={`Option ${index + 1} name`} placeholder={index === 0 ? 'e.g. Size' : index === 1 ? 'e.g. Colour' : 'e.g. Style'} value={option.name} onChange={event => mutateProduct(managedProduct.clientId, current => ({ ...current, optionSets: current.optionSets.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) }))} style={inputStyle} />
                <input aria-label={`Option ${index + 1} values`} placeholder={index === 0 ? 'e.g. S, M, L' : index === 1 ? 'e.g. Red, Green, Blue' : 'e.g. Short Sleeve, Long Sleeve'} value={option.values} onChange={event => mutateProduct(managedProduct.clientId, current => ({ ...current, optionSets: current.optionSets.map((item, itemIndex) => itemIndex === index ? { ...item, values: event.target.value } : item) }))} style={inputStyle} />
                <button type="button" title={`Remove option ${index + 1}`} aria-label={`Remove option ${index + 1}`} disabled={managedProduct.optionSets.length === 1} onClick={() => mutateProduct(managedProduct.clientId, current => ({ ...current, optionSets: current.optionSets.filter((_, itemIndex) => itemIndex !== index) }))} style={{ ...buttonStyle, padding: 5, opacity: managedProduct.optionSets.length === 1 ? .4 : 1 }}><Trash2 size={14} /></button>
              </div>)}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              {managedProduct.optionSets.length < 3 && <button type="button" onClick={() => mutateProduct(managedProduct.clientId, current => ({ ...current, optionSets: [...current.optionSets, { name: '', values: '' }] }))} style={buttonStyle}><Plus size={14} /> Option</button>}
              <button type="button" onClick={() => generateVariants(managedProduct)} style={{ ...buttonStyle, borderColor: 'var(--sv-action)', color: 'var(--sv-action)' }}><Sparkles size={14} /> Generate variants</button>
            </div>
            <div style={{ marginTop: 16, borderTop: '1px solid var(--sv-etch)' }}>
              {managedProduct.variants.map(variant => <div key={variant.clientId} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) minmax(180px, 1.4fr)', gap: 10, alignItems: 'center', padding: '9px 2px', borderBottom: '1px solid var(--sv-etch)' }}>
                <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--sv-text-main)' }}>{variantLabel(variant)}</div>
                <div data-row-id={variant.clientId} data-field-id="sku"><input aria-label={`${variantLabel(variant)} variant SKU`} value={variant.sku} onChange={event => updateVariantField(managedProduct.clientId, variant.clientId, 'sku', event.target.value)} style={{ ...inputStyle, borderColor: errors[variant.clientId]?.sku ? 'var(--sv-red)' : 'var(--sv-etch)' }} />{errors[variant.clientId]?.sku && <div style={{ marginTop: 3, color: 'var(--sv-red)', fontSize: 11 }}>{errors[variant.clientId].sku}</div>}</div>
              </div>)}
            </div>
          </div>
        </div>
      </div>}
    </div>
  );
}