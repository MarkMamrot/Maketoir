'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Columns3, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
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
import { useTableArrowScroll } from '../../hooks/useTableArrowScroll';

interface LookupOption { id: number | string; name: string }

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
  is_active: number;
}

interface FillState {
  fieldId: string;
  owner: BulkProductFieldOwner;
  sourceRowId: string;
  targetRowId: string;
  value: unknown;
}

interface VisibleRow {
  id: string;
  owner: BulkProductFieldOwner;
  productClientId: string;
  variantClientId?: string;
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

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function blankVariant(baseSku = ''): VariantDraft {
  return {
    clientId: newId('variant'), option1Value: '', option2Value: '', option3Value: '', sku: baseSku, barcode: '',
    cost_aud: '', price_rrp: '', price_wholesale: '', price_rrp_sale: '', discount_start_date: '', discount_end_date: '',
    weight_kg: '', cost_foreign: '', is_active: 1,
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
    variants: apiVariants.map((variant: Record<string, any>) => ({
      clientId: `variant-${variant.variant_id}`, variantId: String(variant.variant_id), option1Value: String(variant.option1_value ?? ''),
      option2Value: String(variant.option2_value ?? ''), option3Value: String(variant.option3_value ?? ''), sku: String(variant.sku ?? ''),
      barcode: String(variant.barcode ?? ''), cost_aud: variant.cost_aud == null ? '' : String(variant.cost_aud),
      price_rrp: variant.price_rrp == null ? '' : String(variant.price_rrp), price_wholesale: variant.price_wholesale == null ? '' : String(variant.price_wholesale),
      price_rrp_sale: variant.price_rrp_sale == null ? '' : String(variant.price_rrp_sale),
      discount_start_date: variant.discount_start_date ? String(variant.discount_start_date).slice(0, 10) : '',
      discount_end_date: variant.discount_end_date ? String(variant.discount_end_date).slice(0, 10) : '',
      weight_kg: variant.weight_kg == null ? '' : String(variant.weight_kg), cost_foreign: String(variant.cost_foreign ?? ''),
      is_active: Number(variant.is_active ?? 1),
    })),
  };
}

function variantLabel(variant: VariantDraft): string {
  return [variant.option1Value, variant.option2Value, variant.option3Value].filter(Boolean).join(' / ') || 'Default';
}

export function BulkAddEditProductsView({ businessId }: { businessId: string }) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [brands, setBrands] = useState<LookupOption[]>([]);
  const [suppliers, setSuppliers] = useState<LookupOption[]>([]);
  const [serverProducts, setServerProducts] = useState<ProductDraft[]>([]);
  const [dirtyProducts, setDirtyProducts] = useState<Record<string, ProductDraft>>({});
  const [newProducts, setNewProducts] = useState<ProductDraft[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [configurationLoaded, setConfigurationLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const [query, setQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [fill, setFill] = useState<FillState | null>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  useTableArrowScroll(bodyScrollRef);

  const productSettings = useMemo(() => parseProductSettings(settings), [settings]);
  const availableFields = useMemo(
    () => enabledBulkProductFields(productSettings, settings.use_foreign_currencies !== 'no'),
    [productSettings, settings.use_foreign_currencies],
  );
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
    ]).then(([settingsResult, brandsResult, suppliersResult]) => {
      setSettings(settingsResult.data ?? {});
      setBrands(brandsResult.data ?? []);
      setSuppliers(suppliersResult.data ?? []);
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
    setMessage('');
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
      setMessage(error instanceof Error ? error.message : 'Products could not be loaded.');
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
    mutateProduct(productClientId, product => ({ ...product, [fieldId]: value }));
    setErrors(current => ({ ...current, [productClientId]: { ...current[productClientId], [fieldId]: '' } }));
  };

  const updateVariantField = (productClientId: string, variantClientId: string, fieldId: string, value: unknown) => {
    const dataField = fieldId === 'is_active_variant' ? 'is_active' : fieldId;
    mutateProduct(productClientId, product => ({
      ...product,
      variants: product.variants.map(variant => variant.clientId === variantClientId ? { ...variant, [dataField]: value } : variant),
    }));
    setErrors(current => ({ ...current, [variantClientId]: { ...current[variantClientId], [fieldId]: '' } }));
  };

  const visibleRows = useMemo<VisibleRow[]>(() => displayedProducts.flatMap(product => {
    const rows: VisibleRow[] = [{ id: product.clientId, owner: 'product', productClientId: product.clientId }];
    if (expanded.has(product.clientId)) rows.push(...product.variants.map(variant => ({
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
        const dataField = state.fieldId === 'is_active_variant' ? 'is_active' : state.fieldId;
        return {
          ...product,
          variants: product.variants.map(variant => rowIds.has(variant.clientId) ? { ...variant, [dataField]: state.value } : variant),
        };
      });
      for (const rowId of rowIds) {
        setErrors(current => ({ ...current, [rowId]: { ...current[rowId], [state.fieldId]: '' } }));
      }
    }
  };

  useEffect(() => {
    if (!fill) return;
    const finish = () => { applyFill(fill); setFill(null); };
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setFill(null); };
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('keydown', cancel);
    return () => { window.removeEventListener('pointerup', finish); window.removeEventListener('keydown', cancel); };
  }, [fill, visibleRows]);

  const addProduct = () => {
    const product = blankProduct();
    setNewProducts(current => [product, ...current]);
    setExpanded(current => new Set(current).add(product.clientId));
  };

  const generateVariants = (product: ProductDraft) => {
    if (!product.base_sku.trim()) {
      setErrors(current => ({ ...current, [product.clientId]: { ...current[product.clientId], base_sku: 'Enter Product SKU before generating variants.' } }));
      return;
    }
    const result = reconcileVariantMatrix(product.base_sku, product.optionSets, product.variants, () => newId('variant'));
    mutateProduct(product.clientId, current => ({ ...current, variants: result.variants.map(variant => ({ ...blankVariant(), ...variant })) as VariantDraft[] }));
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
        body: JSON.stringify({ products: products.map(product => ({
          ...product,
          variants: product.variants.map(variant => ({
            ...variant,
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

  const allExpanded = displayedProducts.length > 0 && displayedProducts.every(product => expanded.has(product.clientId));
  const totalWidth = 44 + 140 + fields.reduce((sum, field) => sum + field.width, 0);
  const renderColGroup = () => <colgroup><col style={{ width: 44 }} /><col style={{ width: 140 }} />{fields.map(field => <col key={field.id} style={{ width: field.width }} />)}</colgroup>;

  const valueFor = (product: ProductDraft, variant: VariantDraft | undefined, field: BulkProductFieldDefinition) => {
    if (field.owner === 'product') return product[field.id] ?? '';
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
    const common = { value: String(value ?? ''), onChange: (event: any) => update(event.target.value), style: { ...inputStyle, borderColor: error ? 'var(--sv-red)' : 'var(--sv-etch)' }, 'aria-invalid': Boolean(error), title: error || field.label };
    let editor;
    if (field.editor === 'boolean') {
      editor = <input type="checkbox" checked={Number(value) === 1} onChange={event => update(event.target.checked ? 1 : 0)} aria-label={field.label} />;
    } else if (field.id === 'brand') {
      editor = <><input {...common} list="bulk-product-brands" /><datalist id="bulk-product-brands">{brands.map(brand => <option key={brand.id} value={brand.name} />)}</datalist></>;
    } else if (field.id === 'supplier_contact_id') {
      editor = <select {...common}><option value="">None</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select>;
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
        style={{ position: 'relative', minHeight: 30, display: 'flex', alignItems: 'center', justifyContent: field.editor === 'boolean' ? 'center' : 'stretch', background: fill?.targetRowId === rowId && fill.fieldId === field.id ? 'color-mix(in srgb, var(--sv-action) 12%, transparent)' : undefined }}
      >
        {editor}
        {field.fillDown && (
          <button
            type="button"
            aria-label={`Fill ${field.label} down`}
            title={`Drag to fill ${field.label}; press Enter to fill compatible visible rows below`}
            onPointerDown={event => { event.preventDefault(); setFill({ fieldId: field.id, owner: field.owner, sourceRowId: rowId, targetRowId: rowId, value }); }}
            onKeyDown={event => {
              if (event.key !== 'Enter') return;
              const rows = visibleRows.filter(row => row.owner === field.owner);
              const index = rows.findIndex(row => row.id === rowId);
              if (index >= 0) applyFill({ fieldId: field.id, owner: field.owner, sourceRowId: rowId, targetRowId: rows.at(-1)?.id ?? rowId, value });
            }}
            style={{ position: 'absolute', right: 1, bottom: 1, width: 8, height: 8, padding: 0, border: 0, background: 'var(--sv-action)', cursor: 'crosshair' }}
          />
        )}
        {error && <span style={{ position: 'absolute', left: 2, top: '100%', zIndex: 8, background: 'var(--sv-red)', color: '#fff', fontSize: 10, padding: '2px 5px', whiteSpace: 'nowrap' }}>{error}</span>}
      </div>
    );
  };

  const renderDataRow = (product: ProductDraft, variant?: VariantDraft) => {
    const owner: BulkProductFieldOwner = variant ? 'variant' : 'product';
    return (
      <tr key={variant?.clientId ?? product.clientId} style={{ background: variant ? 'var(--sv-bg-2)' : 'var(--sv-bg-1)' }}>
        <td style={{ position: 'sticky', left: 0, zIndex: 3, background: variant ? 'var(--sv-bg-2)' : 'var(--sv-bg-1)', padding: 4, borderBottom: '1px solid var(--sv-etch)', textAlign: 'center' }}>
          {!variant && <button type="button" aria-label={`${expanded.has(product.clientId) ? 'Collapse' : 'Expand'} ${product.name || 'new product'}`} onClick={() => setExpanded(current => { const next = new Set(current); next.has(product.clientId) ? next.delete(product.clientId) : next.add(product.clientId); return next; })} style={{ ...buttonStyle, padding: 4, border: 0 }}>
            {expanded.has(product.clientId) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>}
        </td>
        <td style={{ position: 'sticky', left: 44, zIndex: 2, background: variant ? 'var(--sv-bg-2)' : 'var(--sv-bg-1)', padding: '5px 8px', borderBottom: '1px solid var(--sv-etch)', boxShadow: '3px 0 5px rgba(15,23,42,.06)', fontSize: 11, fontWeight: 650, color: 'var(--sv-text-dim)' }}>
          {variant ? variantLabel(variant) : product.productId ? 'Existing product' : 'New product'}
        </td>
        {fields.map(field => <td key={field.id} style={{ padding: 3, borderBottom: '1px solid var(--sv-etch)', verticalAlign: 'top' }}>{field.owner === owner ? renderEditor(product, variant, field) : null}</td>)}
      </tr>
    );
  };

  return (
    <div style={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div><h2 style={{ margin: 0, fontSize: 19, color: 'var(--sv-text-strong)' }}>Bulk Add/Edit Products</h2><div style={{ marginTop: 3, color: 'var(--sv-text-dim)', fontSize: 12 }}>Catalogue and variant fields across all locations</div></div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" onClick={addProduct} style={buttonStyle}><Plus size={15} /> Add products</button>
          <div style={{ position: 'relative' }}>
            <button type="button" aria-expanded={fieldsOpen} onClick={() => setFieldsOpen(open => !open)} style={buttonStyle}><Columns3 size={15} /> Add fields</button>
            {fieldsOpen && <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 5px)', zIndex: 20, width: 290, maxHeight: 420, overflowY: 'auto', padding: 10, background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 6, boxShadow: '0 12px 28px rgba(15,23,42,.16)' }}>
              {(['product', 'variant'] as const).map(owner => <div key={owner}><div style={{ margin: '5px 4px', fontSize: 10, fontWeight: 750, color: 'var(--sv-text-dim)', textTransform: 'uppercase' }}>{owner} fields</div>{availableFields.filter(field => field.owner === owner).map(field => <label key={field.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', fontSize: 12 }}><input type="checkbox" disabled={field.required} checked={selectedFields.includes(field.id)} onChange={event => setSelectedFields(current => sanitizeBulkProductFieldSelection(event.target.checked ? [...current, field.id] : current.filter(id => id !== field.id), availableFields))} />{field.label}</label>)}</div>)}
            </div>}
          </div>
          <button type="button" onClick={() => {
            const generated = populateBlankProductSkus(displayedProducts.map(product => ({ clientId: product.clientId, brand: product.brand, baseSku: product.base_sku })));
            generated.forEach(row => { if (row.baseSku !== displayedProducts.find(product => product.clientId === row.clientId)?.base_sku) updateProductField(String(row.clientId), 'base_sku', row.baseSku ?? ''); });
          }} style={buttonStyle}><Sparkles size={15} /> Auto Generate Product SKU</button>
          <button type="button" disabled={!dirtyCount || saving} onClick={discard} style={{ ...buttonStyle, opacity: !dirtyCount || saving ? .5 : 1 }}><Trash2 size={15} /> Discard</button>
          <button type="button" title={hasRequiredFieldErrors ? 'Enter Product Name, Product SKU and Variant SKU for every changed product.' : 'Save all changed products'} disabled={!dirtyCount || saving || hasRequiredFieldErrors} onClick={() => void save()} style={{ ...buttonStyle, borderColor: 'var(--sv-action)', background: 'var(--sv-action)', color: '#fff', opacity: !dirtyCount || saving || hasRequiredFieldErrors ? .5 : 1 }}><Save size={15} /> {saving ? 'Saving...' : `Save${dirtyCount ? ` (${dirtyCount})` : ''}`}</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Search name, SKU, barcode or brand" style={{ ...inputStyle, width: 270 }} />
        <select value={brandFilter} onChange={event => { setBrandFilter(event.target.value); setPage(1); }} style={{ ...inputStyle, width: 170 }}><option value="">All brands</option>{brands.map(brand => <option key={brand.id} value={brand.name}>{brand.name}</option>)}</select>
        <select value={supplierFilter} onChange={event => { setSupplierFilter(event.target.value); setPage(1); }} style={{ ...inputStyle, width: 190 }}><option value="">All suppliers</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select>
        <button type="button" onClick={() => setExpanded(allExpanded ? new Set() : new Set(displayedProducts.map(product => product.clientId)))} style={buttonStyle}>{allExpanded ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}{allExpanded ? 'Collapse all' : 'Expand all'}</button>
        <span style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>{total} existing products{newProducts.length ? ` + ${newProducts.length} new` : ''}</span>
      </div>
      {message && <div role="status" style={{ marginBottom: 10, padding: '8px 10px', border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-2)', color: 'var(--sv-text-main)', fontSize: 12 }}>{message}</div>}

      <div style={{ border: '1px solid var(--sv-etch)', minWidth: 0 }}>
        <div ref={headerScrollRef} style={{ position: 'sticky', top: 0, zIndex: 10, overflow: 'hidden', background: 'var(--sv-bg-2)' }}>
          <table style={{ width: totalWidth, tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }}>{renderColGroup()}<thead><tr><th style={{ position: 'sticky', left: 0, zIndex: 12, background: 'var(--sv-bg-2)', borderBottom: '1px solid var(--sv-etch)', height: 34 }} /><th style={{ position: 'sticky', left: 44, zIndex: 11, background: 'var(--sv-bg-2)', borderBottom: '1px solid var(--sv-etch)', boxShadow: '3px 0 5px rgba(15,23,42,.06)', textAlign: 'left', padding: '0 8px', fontSize: 11 }}>Row</th>{fields.map(field => <th key={field.id} style={{ borderBottom: '1px solid var(--sv-etch)', textAlign: 'left', padding: '0 7px', fontSize: 11, color: 'var(--sv-text-dim)' }}>{field.label}</th>)}</tr></thead></table>
        </div>
        <div ref={bodyScrollRef} className="ims-sticky-table ims-sticky-table--self-scroll bulk-add-edit-products-scroll" tabIndex={0} role="region" aria-label="Bulk Add/Edit Products table. Use Left and Right arrows to scroll columns and Up and Down arrows to scroll the page." onScroll={event => { if (headerScrollRef.current) headerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft; }} style={{ overflowX: 'auto', overflowY: 'hidden', minWidth: 0 }}>
          <table style={{ width: totalWidth, tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }}>{renderColGroup()}<tbody>
            {displayedProducts.map(product => <Fragment key={product.clientId}>
              {renderDataRow(product)}
              {expanded.has(product.clientId) && <tr key={`${product.clientId}-options`} style={{ background: 'var(--sv-bg-2)' }}><td style={{ position: 'sticky', left: 0, zIndex: 3, background: 'var(--sv-bg-2)', borderBottom: '1px solid var(--sv-etch)' }} /><td style={{ position: 'sticky', left: 44, zIndex: 2, background: 'var(--sv-bg-2)', borderBottom: '1px solid var(--sv-etch)', boxShadow: '3px 0 5px rgba(15,23,42,.06)', padding: 6, fontSize: 11, fontWeight: 700 }}>Variant matrix</td><td colSpan={fields.length} style={{ padding: 7, borderBottom: '1px solid var(--sv-etch)' }}><div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>{product.optionSets.map((option, index) => <span key={index} style={{ display: 'inline-flex', gap: 4 }}><input aria-label={`Option ${index + 1} name`} placeholder={index === 0 ? 'Size' : index === 1 ? 'Colour' : 'Style'} value={option.name} onChange={event => mutateProduct(product.clientId, current => ({ ...current, optionSets: current.optionSets.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) }))} style={{ ...inputStyle, width: 95 }} /><input aria-label={`Option ${index + 1} values`} placeholder="S, M, L" value={option.values} onChange={event => mutateProduct(product.clientId, current => ({ ...current, optionSets: current.optionSets.map((item, itemIndex) => itemIndex === index ? { ...item, values: event.target.value } : item) }))} style={{ ...inputStyle, width: 150 }} /></span>)}{product.optionSets.length < 3 && <button type="button" onClick={() => mutateProduct(product.clientId, current => ({ ...current, optionSets: [...current.optionSets, { name: '', values: '' }] }))} style={buttonStyle}><Plus size={13} /> Option</button>}<button type="button" onClick={() => generateVariants(product)} style={buttonStyle}><Sparkles size={13} /> Generate variants</button><button type="button" onClick={() => mutateProduct(product.clientId, current => ({ ...current, variants: [...current.variants, blankVariant(current.base_sku)] }))} style={buttonStyle}><Plus size={13} /> Blank variant</button></div></td></tr>}
              {expanded.has(product.clientId) && product.variants.map(variant => renderDataRow(product, variant))}
            </Fragment>)}
            {!loading && !displayedProducts.length && <tr><td colSpan={fields.length + 2} style={{ padding: 28, textAlign: 'center', color: 'var(--sv-text-dim)', fontSize: 13 }}>No products match these filters. Use Add products to begin a new batch.</td></tr>}
            {loading && <tr><td colSpan={fields.length + 2} style={{ padding: 28, textAlign: 'center', color: 'var(--sv-text-dim)', fontSize: 13 }}>Loading products...</td></tr>}
          </tbody></table>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 10 }}><button type="button" disabled={page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))} style={{ ...buttonStyle, opacity: page <= 1 ? .5 : 1 }}>Previous</button><span style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>Page {page} of {Math.max(1, Math.ceil(total / 50))}</span><button type="button" disabled={page * 50 >= total} onClick={() => setPage(current => current + 1)} style={{ ...buttonStyle, opacity: page * 50 >= total ? .5 : 1 }}>Next</button></div>
    </div>
  );
}