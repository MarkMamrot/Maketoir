'use client';

import { PackageCheck, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { suggestParcels, type PackableUnit, type PackingPreset } from '@/lib/ims/shipping/packingSuggestions';
import { getShippingOrderEligibility } from '@/lib/ims/shipping/shippingWorkflow';

type SalesOrderSummary = {
  id: number;
  so_number: string;
  channel_order_number?: string | null;
  external_order_number?: string | null;
  shopify_order_name?: string | null;
  native_checkout_id?: string | null;
  customer_name?: string | null;
  status: string;
  so_type?: string | null;
  is_pos_ledger?: boolean;
  remaining_quantity?: number;
};

type SalesOrderDetail = SalesOrderSummary & {
  delivery_address?: string | null;
  delivery_suburb?: string | null;
  delivery_state?: string | null;
  delivery_postcode?: string | null;
  items?: Array<{ id: number; sku?: string | null; product_name?: string | null; qty_ordered: number; qty_fulfilled: number; weight_kg?: number | null; length_mm?: number | null; width_mm?: number | null; height_mm?: number | null }>;
};

type CarrierAccount = {
  id: number; displayName: string; provider: string; verifiedAt: string | null; isActive: boolean;
  dispatchLocationName: string | null; dispatchAddressMissingFields: string[];
};
type ParcelAllocation = { soItemId: number; quantity: number };
type EditableParcel = {
  packagePresetId: string;
  packageType: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  weightKg: string;
  allocations: ParcelAllocation[];
};
type ShippingRate = { serviceCode: string; serviceName: string; total: number; totalExGst: number; gst: number };

export function ShipOrdersWorkspace({ orders, onClose }: { orders: SalesOrderSummary[]; onClose: () => void }) {
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const selectedOrderKey = orders.map(order => Number(order.id)).sort((left, right) => left - right).join(',');
  const [details, setDetails] = useState<SalesOrderDetail[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<CarrierAccount[]>([]);
  const [presets, setPresets] = useState<PackingPreset[]>([]);
  const [carrierAccountId, setCarrierAccountId] = useState('');
  const [parcelsByOrder, setParcelsByOrder] = useState<Record<number, EditableParcel[]>>({});
  const [quotesByOrder, setQuotesByOrder] = useState<Record<number, ShippingRate[]>>({});
  const [quoting, setQuoting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<Array<{ soId: number; shipmentId: number }>>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const selectedOrders = ordersRef.current;
    Promise.all([
      Promise.all(selectedOrders.map(async order => {
      const response = await fetch(`/api/ims/sales-orders/${order.id}`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || `Unable to load ${order.so_number}.`);
      return result.data as SalesOrderDetail;
      })),
      fetch('/api/ims/shipping/settings').then(async response => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Unable to load shipping settings.');
        return result.data as { accounts: CarrierAccount[]; presets: PackingPreset[] };
      }),
    ]).then(([orderDetails, settings]) => {
      if (!active) return;
      setDetails(orderDetails);
      const activeAccounts = settings.accounts.filter(account => account.isActive && account.provider === 'auspost_eparcel');
      const activePresets = settings.presets.filter((preset: PackingPreset & { isActive?: boolean }) => preset.isActive !== false);
      setAccounts(activeAccounts);
      setPresets(activePresets);
      setCarrierAccountId(activeAccounts[0] ? String(activeAccounts[0].id) : '');
      setParcelsByOrder(Object.fromEntries(orderDetails.map(order => [order.id, initialParcels(order, activePresets)])));
    })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to prepare these orders.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedOrderKey]);

  const plans = details.map(order => ({ order, ...buildPackingPlan(order, presets) }));
  const selectedAccount = accounts.find(account => String(account.id) === carrierAccountId);
  const dispatchAddressReady = Boolean(selectedAccount && selectedAccount.dispatchAddressMissingFields.length === 0);
  const canCreate = dispatchAddressReady && plans.length > 0 && plans.every(plan => plan.ready && validEditableParcels(plan.order, parcelsByOrder[plan.order.id]));
  const shipments = plans.map(plan => ({
    soId: plan.order.id,
    parcels: (parcelsByOrder[plan.order.id] ?? []).map((parcel, index) => ({
      parcelNumber: index + 1,
      packagePresetId: parcel.packagePresetId ? Number(parcel.packagePresetId) : null,
      packageType: parcel.packageType || 'custom',
      lengthMm: Number(parcel.lengthMm),
      widthMm: Number(parcel.widthMm),
      heightMm: Number(parcel.heightMm),
      weightKg: Number(parcel.weightKg),
      allocations: parcel.allocations.filter(allocation => allocation.quantity > 0),
    })),
  }));

  const updateParcel = (soId: number, parcelIndex: number, patch: Partial<EditableParcel>) => {
    setParcelsByOrder(current => ({
      ...current,
      [soId]: (current[soId] ?? []).map((parcel, index) => index === parcelIndex ? { ...parcel, ...patch } : parcel),
    }));
    setError('');
    setQuotesByOrder({});
  };

  const choosePreset = (soId: number, parcelIndex: number, presetId: string) => {
    const preset = presets.find(item => item.id === Number(presetId));
    updateParcel(soId, parcelIndex, preset ? {
      packagePresetId: presetId,
      packageType: preset.packageType,
      lengthMm: String(preset.lengthMm),
      widthMm: String(preset.widthMm),
      heightMm: String(preset.heightMm),
    } : { packagePresetId: '', packageType: 'custom' });
  };

  const updateAllocation = (soId: number, parcelIndex: number, soItemId: number, quantity: string) => {
    const value = quantity === '' ? 0 : Number(quantity);
    const parcel = parcelsByOrder[soId]?.[parcelIndex];
    if (!parcel) return;
    updateParcel(soId, parcelIndex, {
      allocations: parcel.allocations.map(allocation => allocation.soItemId === soItemId ? { ...allocation, quantity: value } : allocation),
    });
  };

  const addParcel = (order: SalesOrderDetail) => {
    setParcelsByOrder(current => ({
      ...current,
      [order.id]: [...(current[order.id] ?? []), {
        packagePresetId: '', packageType: 'custom', lengthMm: '', widthMm: '', heightMm: '', weightKg: '',
        allocations: remainingAllocations(order, 0),
      }],
    }));
    setError('');
    setQuotesByOrder({});
  };

  const removeParcel = (soId: number, parcelIndex: number) => {
    setParcelsByOrder(current => ({ ...current, [soId]: (current[soId] ?? []).filter((_, index) => index !== parcelIndex) }));
    setError('');
    setQuotesByOrder({});
  };

  const getQuotes = async () => {
    setQuoting(true); setError(''); setQuotesByOrder({});
    try {
      const response = await fetch('/api/ims/shipping/quotes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrierAccountId: Number(carrierAccountId), shipments }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to retrieve shipping prices.');
      const quotes = Object.fromEntries((result.data ?? []).map((quote: { soId: number; rates: ShippingRate[] }) => [quote.soId, quote.rates]));
      setQuotesByOrder(quotes);
      if ((result.data ?? []).some((quote: { rates: ShippingRate[] }) => quote.rates.length === 0)) {
        setError('Australia Post did not return a common service for every parcel on one or more orders.');
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to retrieve shipping prices.'); }
    finally { setQuoting(false); }
  };

  const createDrafts = async () => {
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/ims/shipping/drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationKey: crypto.randomUUID(), carrierAccountId: Number(carrierAccountId),
          shipments,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to prepare shipments.');
      setCreated(result.data ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to prepare shipments.'); }
    finally { setSaving(false); }
  };

  return <div role="dialog" aria-modal="true" aria-label="Ship orders" style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(15,23,42,.58)', display: 'grid', placeItems: 'center', padding: 20 }}>
    <div style={{ width: 'min(920px, 100%)', maxHeight: 'calc(100vh - 40px)', overflow: 'auto', background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 8, boxShadow: '0 22px 60px rgba(0,0,0,.28)' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--sv-etch)', background: 'var(--sv-bg-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><PackageCheck size={19} color="var(--sv-action)" /><div><h2 style={{ margin: 0, fontSize: 17 }}>Ship orders</h2><div style={{ marginTop: 2, fontSize: 12, color: 'var(--sv-text-dim)' }}>{orders.length} selected</div></div></div>
        <button type="button" title="Close" onClick={onClose} style={iconButtonStyle}><X size={17} /></button>
      </header>
      <div style={{ padding: 18 }}>
        {loading && <div style={{ color: 'var(--sv-text-dim)', fontSize: 13 }}>Checking order lines and delivery addresses...</div>}
        {error && <div role="alert" style={{ color: 'var(--sv-red)', fontSize: 13 }}>{error}</div>}
        {!loading && !created.length && <div style={{ marginBottom: 14 }}><label style={{ display: 'block', width: 'min(360px,100%)' }}><span style={{ display: 'block', marginBottom: 5, fontSize: 12, fontWeight: 700 }}>Carrier account</span><select value={carrierAccountId} onChange={event => { setCarrierAccountId(event.target.value); setError(''); setQuotesByOrder({}); }} style={selectStyle}><option value="">Choose an account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.displayName}{account.verifiedAt ? '' : ' (not verified)'}</option>)}</select></label>{selectedAccount?.dispatchAddressMissingFields.length ? <div role="alert" style={{ marginTop: 7, fontSize: 12, color: 'var(--sv-red)' }}>Dispatch location <strong>{selectedAccount.dispatchLocationName || 'not selected'}</strong> is missing {selectedAccount.dispatchAddressMissingFields.join(', ')}. <button type="button" onClick={() => { onClose(); window.location.hash = 'locations'; }} style={linkButtonStyle}>Update location</button></div> : null}</div>}
        {!loading && !created.length && plans.map(({ order, remainingQuantity, eligibility, hasAddress, ready, suggestion }) => {
          const orderParcels = parcelsByOrder[order.id] ?? [];
          const rates = quotesByOrder[order.id] ?? [];
          const parcelIssue = editableParcelIssue(order, orderParcels);
          return <div key={order.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--sv-etch)' }}><div style={{ display: 'grid', gridTemplateColumns: 'minmax(130px,.7fr) minmax(170px,1fr) minmax(220px,1.3fr) auto', gap: 14, alignItems: 'center' }}>
            <div><strong style={{ fontSize: 13 }}>{order.so_number}</strong>{getChannelOrderNumber(order) && <div style={{ marginTop: 2, fontSize: 11, color: 'var(--sv-text-dim)' }}>Channel Order # {getChannelOrderNumber(order)}</div>}<div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{remainingQuantity} unit{remainingQuantity === 1 ? '' : 's'} remaining</div></div>
            <div style={{ fontSize: 12 }}>{order.customer_name || 'No customer name'}</div>
            <div style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>{hasAddress ? [order.delivery_address, order.delivery_suburb, order.delivery_state, order.delivery_postcode].filter(Boolean).join(', ') : 'Delivery address is incomplete'}</div>
            <span style={{ fontSize: 11, fontWeight: 700, color: ready ? 'var(--sv-green)' : 'var(--sv-red)' }}>{ready ? 'Ready' : eligibility.eligible ? 'Address required' : eligibility.reason}</span>
          </div>{ready && <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            {suggestion.unpacked.length > 0 && <div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>Automatic packing was unavailable for {suggestion.unpacked.length} item{suggestion.unpacked.length === 1 ? '' : 's'}. Enter the packed parcel details below.</div>}
            {orderParcels.map((parcel, parcelIndex) => <div key={parcelIndex} style={{ padding: 10, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}><span style={{ fontSize: 12, fontWeight: 700 }}>Parcel {parcelIndex + 1}</span>{orderParcels.length > 1 && <button type="button" title={`Remove parcel ${parcelIndex + 1}`} onClick={() => removeParcel(order.id, parcelIndex)} style={smallIconButtonStyle}><Trash2 size={14} /></button>}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8 }}>
                <label style={fieldStyle}><span>Preset (optional)</span><select value={parcel.packagePresetId} onChange={event => choosePreset(order.id, parcelIndex, event.target.value)} style={selectStyle}><option value="">Manual dimensions</option>{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
                <ParcelNumberField label="Length (mm)" value={parcel.lengthMm} onChange={value => updateParcel(order.id, parcelIndex, { lengthMm: value })} />
                <ParcelNumberField label="Width (mm)" value={parcel.widthMm} onChange={value => updateParcel(order.id, parcelIndex, { widthMm: value })} />
                <ParcelNumberField label="Height (mm)" value={parcel.heightMm} onChange={value => updateParcel(order.id, parcelIndex, { heightMm: value })} />
                <ParcelNumberField label="Packed weight (kg)" value={parcel.weightKg} step="0.001" onChange={value => updateParcel(order.id, parcelIndex, { weightKg: value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, marginTop: 9 }}>
                {(order.items ?? []).map(item => {
                  const remaining = Math.max(0, Number(item.qty_ordered) - Number(item.qty_fulfilled));
                  if (remaining <= 0) return null;
                  const allocation = parcel.allocations.find(value => value.soItemId === Number(item.id));
                  return <ParcelNumberField key={item.id} label={`${item.sku || item.product_name || `Item ${item.id}`} (of ${remaining})`} value={allocation?.quantity ? String(allocation.quantity) : ''} step="0.0001" onChange={value => updateAllocation(order.id, parcelIndex, Number(item.id), value)} />;
                })}
              </div>
            </div>)}
            <div><button type="button" onClick={() => addParcel(order)} style={{ ...secondaryButtonStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={14} />Add parcel</button></div>
            {parcelIssue && <div role="status" style={{ fontSize: 11, color: 'var(--sv-red)' }}>{parcelIssue}</div>}
            {rates.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{rates.map(rate => <div key={rate.serviceCode} style={{ padding: '7px 9px', border: '1px solid var(--sv-etch)', borderRadius: 6, fontSize: 12 }}><strong>{rate.serviceName}</strong> · {formatAud(rate.total)} <span style={{ color: 'var(--sv-text-dim)' }}>incl. GST</span></div>)}</div>}
          </div>}</div>;
        })}
        {created.length > 0 && <div role="status" style={{ padding: 14, border: '1px solid var(--sv-etch)', borderRadius: 6 }}><strong style={{ fontSize: 13 }}>Shipment drafts prepared</strong><div style={{ marginTop: 4, color: 'var(--sv-text-dim)', fontSize: 12 }}>{created.length} shipment{created.length === 1 ? '' : 's'} saved. Carrier submission and labels are the next step.</div></div>}
        {!loading && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>Cancel</button>
          {!created.length && <button type="button" disabled={!canCreate || quoting || saving} onClick={getQuotes} style={{ ...secondaryButtonStyle, display: 'inline-flex', alignItems: 'center', gap: 7, opacity: canCreate && !quoting && !saving ? 1 : .55, cursor: canCreate && !quoting && !saving ? 'pointer' : 'not-allowed' }}><RefreshCw size={15} />{quoting ? 'Getting prices...' : Object.keys(quotesByOrder).length ? 'Refresh prices' : 'Get shipping prices'}</button>}
          {!created.length && <button type="button" disabled={!canCreate || saving} onClick={createDrafts} style={{ ...primaryButtonStyle, opacity: canCreate && !saving ? 1 : .55, cursor: canCreate && !saving ? 'pointer' : 'not-allowed' }}><PackageCheck size={15} />{saving ? 'Preparing...' : 'Prepare Shipments'}</button>}
        </div>}
      </div>
    </div>
  </div>;
}

const iconButtonStyle: React.CSSProperties = { width: 34, height: 34, display: 'grid', placeItems: 'center', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', cursor: 'pointer' };
const smallIconButtonStyle: React.CSSProperties = { ...iconButtonStyle, width: 28, height: 28 };
const secondaryButtonStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', fontWeight: 700, cursor: 'pointer' };
const primaryButtonStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 12px', border: 0, borderRadius: 6, background: 'var(--sv-action)', color: '#fff', fontWeight: 700 };
const selectStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)' };
const fieldStyle: React.CSSProperties = { display: 'grid', gap: 4, minWidth: 0, color: 'var(--sv-text-dim)', fontSize: 11, fontWeight: 700 };
const linkButtonStyle: React.CSSProperties = { padding: 0, border: 0, background: 'transparent', color: 'var(--sv-action)', font: 'inherit', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' };

function ParcelNumberField({ label, value, step = '1', onChange }: { label: string; value: string; step?: string; onChange: (value: string) => void }) {
  return <label style={fieldStyle}><span>{label}</span><input type="number" min="0" step={step} value={value} onChange={event => onChange(event.target.value)} style={selectStyle} /></label>;
}

function buildPackingPlan(order: SalesOrderDetail, presets: PackingPreset[]) {
  const remainingQuantity = (order.items ?? []).reduce((sum, item) => sum + Math.max(0, Number(item.qty_ordered) - Number(item.qty_fulfilled)), 0);
  const eligibility = getShippingOrderEligibility({ status: order.status as any, soType: order.so_type, isPosLedger: order.is_pos_ledger, remainingQuantity });
  const hasAddress = Boolean(order.delivery_address && order.delivery_suburb && order.delivery_state && order.delivery_postcode);
  const units: PackableUnit[] = [];
  for (const item of order.items ?? []) {
    let remaining = Math.max(0, Number(item.qty_ordered) - Number(item.qty_fulfilled));
    let unitNumber = 1;
    while (remaining > 0) {
      const quantity = Math.min(1, remaining);
      units.push({ soItemId: item.id, reference: `${item.sku || item.product_name || item.id}-${unitNumber}`, quantity, weightKg: Number(item.weight_kg ?? 0) * quantity, lengthMm: Number(item.length_mm ?? 0), widthMm: Number(item.width_mm ?? 0), heightMm: Number(item.height_mm ?? 0) });
      remaining = Math.max(0, remaining - quantity);
      unitNumber += 1;
    }
  }
  return { remainingQuantity, eligibility, hasAddress, ready: eligibility.eligible && hasAddress, suggestion: suggestParcels(units, presets) };
}

function aggregateAllocations(units: PackableUnit[]): Array<{ soItemId: number; quantity: number }> {
  const quantities = new Map<number, number>();
  for (const unit of units) quantities.set(unit.soItemId, (quantities.get(unit.soItemId) ?? 0) + unit.quantity);
  return [...quantities].map(([soItemId, quantity]) => ({ soItemId, quantity }));
}

function initialParcels(order: SalesOrderDetail, presets: PackingPreset[]): EditableParcel[] {
  const plan = buildPackingPlan(order, presets);
  if (plan.suggestion.parcels.length > 0 && plan.suggestion.unpacked.length === 0) {
    return plan.suggestion.parcels.map(parcel => ({
      packagePresetId: String(parcel.preset.id),
      packageType: parcel.preset.packageType,
      lengthMm: String(parcel.preset.lengthMm),
      widthMm: String(parcel.preset.widthMm),
      heightMm: String(parcel.preset.heightMm),
      weightKg: String(Number(parcel.weightKg.toFixed(3))),
      allocations: aggregateAllocations(parcel.units),
    }));
  }
  return [{
    packagePresetId: '', packageType: 'custom', lengthMm: '', widthMm: '', heightMm: '', weightKg: '',
    allocations: remainingAllocations(order),
  }];
}

function remainingAllocations(order: SalesOrderDetail, quantityMultiplier = 1): ParcelAllocation[] {
  return (order.items ?? []).map(item => ({
    soItemId: Number(item.id),
    quantity: Math.max(0, Number(item.qty_ordered) - Number(item.qty_fulfilled)) * quantityMultiplier,
  }));
}

function validEditableParcels(order: SalesOrderDetail, parcels: EditableParcel[] | undefined): boolean {
  return editableParcelIssue(order, parcels) === '';
}

function editableParcelIssue(order: SalesOrderDetail, parcels: EditableParcel[] | undefined): string {
  if (!parcels?.length) return 'Add at least one parcel.';
  const invalidParcelIndex = parcels.findIndex(parcel => ![parcel.lengthMm, parcel.widthMm, parcel.heightMm, parcel.weightKg]
    .every(value => Number.isFinite(Number(value)) && Number(value) > 0));
  if (invalidParcelIndex >= 0) return `Enter positive dimensions and packed weight for parcel ${invalidParcelIndex + 1}.`;
  const emptyParcelIndex = parcels.findIndex(parcel => !parcel.allocations.some(allocation => allocation.quantity > 0));
  if (emptyParcelIndex >= 0) return `Assign at least one item quantity to parcel ${emptyParcelIndex + 1}.`;
  if (parcels.some(parcel => parcel.allocations.some(allocation => !Number.isFinite(allocation.quantity) || allocation.quantity < 0))) {
    return 'Parcel item quantities cannot be negative.';
  }
  const incompleteItem = (order.items ?? []).find(item => {
    const remaining = Math.max(0, Number(item.qty_ordered) - Number(item.qty_fulfilled));
    const allocated = parcels.reduce((sum, parcel) => sum + (parcel.allocations.find(value => value.soItemId === Number(item.id))?.quantity ?? 0), 0);
    return Math.abs(remaining - allocated) >= 0.0001;
  });
  if (incompleteItem) {
    const remaining = Math.max(0, Number(incompleteItem.qty_ordered) - Number(incompleteItem.qty_fulfilled));
    return `Assign exactly ${remaining} of ${incompleteItem.sku || incompleteItem.product_name || `item ${incompleteItem.id}`} across the parcels.`;
  }
  return '';
}

function formatAud(value: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value);
}

function getChannelOrderNumber(order: SalesOrderDetail): string {
  return String(order.channel_order_number ?? order.external_order_number ?? order.shopify_order_name ?? order.native_checkout_id ?? '').trim();
}
