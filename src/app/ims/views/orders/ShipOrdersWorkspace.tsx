'use client';

import { PackageCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { suggestParcels, type PackableUnit, type PackingPreset } from '@/lib/ims/shipping/packingSuggestions';
import { getShippingOrderEligibility } from '@/lib/ims/shipping/shippingWorkflow';

type SalesOrderSummary = {
  id: number;
  so_number: string;
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

type CarrierAccount = { id: number; displayName: string; provider: string; verifiedAt: string | null; isActive: boolean };

export function ShipOrdersWorkspace({ orders, onClose }: { orders: SalesOrderSummary[]; onClose: () => void }) {
  const [details, setDetails] = useState<SalesOrderDetail[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<CarrierAccount[]>([]);
  const [presets, setPresets] = useState<PackingPreset[]>([]);
  const [carrierAccountId, setCarrierAccountId] = useState('');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<Array<{ soId: number; shipmentId: number }>>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      Promise.all(orders.map(async order => {
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
      setAccounts(activeAccounts);
      setPresets(settings.presets.filter((preset: PackingPreset & { isActive?: boolean }) => preset.isActive !== false));
      setCarrierAccountId(activeAccounts[0] ? String(activeAccounts[0].id) : '');
    })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to prepare these orders.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orders]);

  const plans = details.map(order => ({ order, ...buildPackingPlan(order, presets) }));
  const canCreate = Boolean(carrierAccountId) && plans.length > 0 && plans.every(plan => plan.ready && plan.suggestion.unpacked.length === 0 && plan.suggestion.parcels.length > 0);

  const createDrafts = async () => {
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/ims/shipping/drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationKey: crypto.randomUUID(), carrierAccountId: Number(carrierAccountId),
          shipments: plans.map(plan => ({
            soId: plan.order.id,
            parcels: plan.suggestion.parcels.map((parcel, index) => ({
              parcelNumber: index + 1, packagePresetId: parcel.preset.id, packageType: parcel.preset.packageType,
              lengthMm: parcel.preset.lengthMm, widthMm: parcel.preset.widthMm, heightMm: parcel.preset.heightMm,
              weightKg: parcel.weightKg,
              allocations: aggregateAllocations(parcel.units),
            })),
          })),
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
        {!loading && !created.length && <label style={{ display: 'block', width: 'min(360px,100%)', marginBottom: 14 }}><span style={{ display: 'block', marginBottom: 5, fontSize: 12, fontWeight: 700 }}>Carrier account</span><select value={carrierAccountId} onChange={event => setCarrierAccountId(event.target.value)} style={selectStyle}><option value="">Choose an account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.displayName}{account.verifiedAt ? '' : ' (not verified)'}</option>)}</select></label>}
        {!loading && !created.length && plans.map(({ order, remainingQuantity, eligibility, hasAddress, ready, suggestion }) => {
          return <div key={order.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--sv-etch)' }}><div style={{ display: 'grid', gridTemplateColumns: 'minmax(130px,.7fr) minmax(170px,1fr) minmax(220px,1.3fr) auto', gap: 14, alignItems: 'center' }}>
            <div><strong style={{ fontSize: 13 }}>{order.so_number}</strong><div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{remainingQuantity} unit{remainingQuantity === 1 ? '' : 's'} remaining</div></div>
            <div style={{ fontSize: 12 }}>{order.customer_name || 'No customer name'}</div>
            <div style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>{hasAddress ? [order.delivery_address, order.delivery_suburb, order.delivery_state, order.delivery_postcode].filter(Boolean).join(', ') : 'Delivery address is incomplete'}</div>
            <span style={{ fontSize: 11, fontWeight: 700, color: ready ? 'var(--sv-green)' : 'var(--sv-red)' }}>{ready ? 'Ready' : eligibility.eligible ? 'Address required' : eligibility.reason}</span>
          </div>{ready && <div style={{ marginTop: 9, display: 'flex', flexWrap: 'wrap', gap: 8 }}>{suggestion.parcels.map((parcel, index) => <span key={index} style={{ padding: '5px 8px', border: '1px solid var(--sv-etch)', borderRadius: 5, fontSize: 11 }}>{parcel.preset.name} · {parcel.units.length} item{parcel.units.length === 1 ? '' : 's'} · {parcel.weightKg.toFixed(3)} kg</span>)}{suggestion.unpacked.length > 0 && <span style={{ padding: '5px 8px', color: 'var(--sv-red)', fontSize: 11 }}>{suggestion.unpacked.length} item{suggestion.unpacked.length === 1 ? '' : 's'} need physical data or a larger package</span>}{!presets.length && <span style={{ color: 'var(--sv-red)', fontSize: 11 }}>Add an active package preset in Shipping Settings.</span>}</div>}</div>;
        })}
        {created.length > 0 && <div role="status" style={{ padding: 14, border: '1px solid var(--sv-etch)', borderRadius: 6 }}><strong style={{ fontSize: 13 }}>Shipment drafts prepared</strong><div style={{ marginTop: 4, color: 'var(--sv-text-dim)', fontSize: 12 }}>{created.length} shipment{created.length === 1 ? '' : 's'} saved. Carrier submission and labels are the next step.</div></div>}
        {!loading && !error && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>Cancel</button>
          {!created.length && <button type="button" disabled={!canCreate || saving} onClick={createDrafts} style={{ ...primaryButtonStyle, opacity: canCreate && !saving ? 1 : .55, cursor: canCreate && !saving ? 'pointer' : 'not-allowed' }}><PackageCheck size={15} />{saving ? 'Preparing...' : 'Prepare Shipments'}</button>}
        </div>}
      </div>
    </div>
  </div>;
}

const iconButtonStyle: React.CSSProperties = { width: 34, height: 34, display: 'grid', placeItems: 'center', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', cursor: 'pointer' };
const secondaryButtonStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', fontWeight: 700, cursor: 'pointer' };
const primaryButtonStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 12px', border: 0, borderRadius: 6, background: 'var(--sv-action)', color: '#fff', fontWeight: 700 };
const selectStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)' };

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
