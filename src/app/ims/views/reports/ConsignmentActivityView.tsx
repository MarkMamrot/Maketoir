'use client';

import { useEffect, useState } from 'react';
import { SBDatePicker, type SBDateRange } from './reportFilterHelpers';
import { previousCalendarPeriod } from './reportFilterUtils';
import { ConsignmentTable } from '../purchasing/ConsignmentTable';
import { consignmentApi } from '../purchasing/consignmentApi';
import { useFeatureEnabled } from '../../components/FeatureToggleProvider';

interface ActivityRow {
  supplierId: number; variantId: number; sku: string; productName: string; unitCost: number | null; taxRate: number | null;
  quantitySold: number; quantityRefunded: number; netQuantity: number; subtotal: number; tax: number; total: number;
  quantityAdjusted?: number;
}
interface Activity {
  events: { id: number; source_type: string; source_id: string; source_line_id: string; original_event_id: number | null; event_date: string; location_id: number | null; channel: string | null; sku: string | null; quantity: number | string }[];
  rows: ActivityRow[]; totals: Pick<ActivityRow, 'quantitySold' | 'quantityRefunded' | 'quantityAdjusted' | 'netQuantity' | 'subtotal' | 'tax' | 'total'>;
  exceptions: { eventId: string; message: string }[];
}

export function ConsignmentActivityView({ onBack }: { onBack: () => void }) {
  const tracking = useFeatureEnabled('feature_toggle_consignment_tracking');
  const [range, setRange] = useState<SBDateRange>(() => previousCalendarPeriod('month'));
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [channel, setChannel] = useState('');
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);
  const [locations, setLocations] = useState<{ id: number; name: string }[]>([]);
  const [data, setData] = useState<Activity | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const date = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  const to = range.kind === 'range' ? range.to : date(new Date());
  const from = range.kind === 'range' ? range.from : date(new Date(new Date().setDate(new Date().getDate() - range.window + 1)));
  const query = new URLSearchParams({ from, to, supplierId, locationId, channel }).toString();
  useEffect(() => {
    let active = true;
    setBusy(true); setError(''); setData(null);
    consignmentApi<Activity>(`activity?${query}`).then(result => { if (active) setData(result); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load activity.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [query]);
  useEffect(() => {
    Promise.all([fetch('/api/ims/contacts?type=supplier').then(r => r.json()), fetch('/api/ims/locations').then(r => r.json())])
      .then(([contacts, places]) => {
        if (!contacts.success || !places.success) throw new Error('Report filters could not be loaded.');
        setSuppliers(contacts.data); setLocations(places.data);
      }).catch(() => setError('Report filters could not be loaded. Reload to retry.'));
  }, []);
  const money = (value: number) => Number(value || 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
  return <section style={{ minWidth: 0, width: '100%', maxWidth: '100%' }}>
    <button onClick={onBack}>Back to reports</button><h1>Consignment Activity</h1>
    <p>Activity report — not a settlement or outstanding balance. Available independently of Consignment Tracking. Reconcile supplier payments externally; this report does not say what is unpaid or Accounted.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
      <SBDatePicker value={range} onChange={setRange} />
      <label>Supplier <select value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">All suppliers</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Location <select value={locationId} onChange={e => setLocationId(e.target.value)}><option value="">All locations</option>{locations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Channel <input value={channel} list="consignment-channels" placeholder="All channels" onChange={e => setChannel(e.target.value)} /><datalist id="consignment-channels"><option value="pos" /><option value="sales_order" /><option value="shopify" /><option value="native_shop" /></datalist></label>
      {data && <><a href={`/api/ims/consignment/activity?${query}&format=csv`} download>Export CSV</a><a href={`/api/ims/consignment/activity?${query}&format=pdf`} download>Export PDF</a></>}
    </div>
    {tracking && <p><a href="#consignment-statements">Manage settlement statements</a></p>}
    {busy && <p role="status">Loading activity…</p>}{error && <p role="alert">{error}</p>}
    {data && <>
      <p>Sold: {data.totals.quantitySold} · Refunded: {data.totals.quantityRefunded} · Adjusted: {data.totals.quantityAdjusted ?? 0} · Net: {data.totals.netQuantity} · Ex tax: {money(data.totals.subtotal)} · GST: {money(data.totals.tax)} · Total: {money(data.totals.total)}</p>
      {!!data.exceptions.length && <section aria-label="Consignment exceptions"><h2>Exceptions requiring review</h2><ul>{data.exceptions.map((item, index) => <li key={`${item.eventId}-${index}`}>{item.message}</li>)}</ul></section>}
      <div><button aria-pressed={!showSources} onClick={() => setShowSources(false)}>Supplier cost summary</button><button aria-pressed={showSources} onClick={() => setShowSources(true)}>Source activity</button></div>
      <p>Supplier returns are physical stock-only activity, not deductions from sales dues. Refunds may occur without restocking.</p>
      {!showSources ? <ConsignmentTable key="summary" headings={['SKU', 'Product', 'Supplier', 'Sold', 'Refunded', 'Adjusted', 'Net quantity', 'Unit cost', 'Tax rate', 'Ex tax', 'GST', 'Total']}
        rows={data.rows.map(row => [row.sku, row.productName, suppliers.find(s => s.id === row.supplierId)?.name || row.supplierId, row.quantitySold, row.quantityRefunded, row.quantityAdjusted ?? 0, row.netQuantity, row.unitCost == null ? 'Missing cost' : money(row.unitCost), row.taxRate == null ? 'Missing tax' : `${row.taxRate}%`, money(row.subtotal), money(row.tax), money(row.total)])} /> :
      <ConsignmentTable key="sources" headings={['Event', 'Date', 'Source', 'Line', 'Original event', 'SKU', 'Location', 'Channel', 'Quantity']}
        rows={data.events.map(event => [
          event.id, event.event_date,
          <a key={event.id} href={`#${event.source_type === 'supplier_return' ? 'supplier-credit-notes' : event.channel === 'pos' ? 'pos-sales' : 'sales-orders'}/${encodeURIComponent(event.source_id)}`}>{event.source_type} {event.source_id}</a>,
          event.source_line_id, event.original_event_id ?? '—', event.sku ?? '—',
          locations.find(item => Number(item.id) === Number(event.location_id))?.name || event.location_id || '—',
          event.channel || '—', event.quantity,
        ])} />}
    </>}
  </section>;
}
