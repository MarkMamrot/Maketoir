'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Banknote, PackageCheck, Printer, RefreshCw, X } from 'lucide-react';
import type { CompletedSale, PaymentEntry, PosSession } from '../_types';
import { planLaybyCancellation } from '@/lib/pos/laybyPayments';
import { loadDeviceConfig } from '../_store';

type Layby = { id: number; customer_name: string; total: number | string; paid_total: number | string; fee_percent: number | string; layby_state: string; retained_fee: number | string; accounting_status?: string };
type PaymentOptions = { total: number; isLayby: boolean; error: string; extraContent?: ReactNode; onComplete: (payments: PaymentEntry[]) => void; onCancel: () => void };
type PendingAction = { layby: Layby; body: Record<string, unknown> };
const money = (value: number | string) => Number(value).toFixed(2);
const button = { padding: '8px 12px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-2)', color: 'var(--sv-text-main)', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' };

export function LaybyWorkspace({ session, onBack, onReceipt, renderPayment }: {
  session: PosSession; onBack: () => void; onReceipt: (sale: CompletedSale) => void;
  renderPayment: (options: PaymentOptions) => ReactNode;
}) {
  const [laybys, setLaybys] = useState<Layby[]>([]);
  const [search, setSearch] = useState('');
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const storageKey = `pos_layby_pending:${loadDeviceConfig()?.business_id ?? 'unassigned'}:${session.location_id}:${session.register_id}`;
  const openingKey = `pos_layby_opening:${loadDeviceConfig()?.business_id}:${session.location_id}:${session.register_id}`;
  const [opening, setOpening] = useState<Record<string, unknown> | null>(() => {
    try { return JSON.parse(localStorage.getItem(openingKey) ?? 'null'); } catch { return null; }
  });
  const [pending, setPending] = useState<PendingAction | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      return saved?.body?.operation_key && saved?.layby?.id ? saved : null;
    } catch { return null; }
  });
  const [selected, setSelected] = useState<{ layby: Layby; action: 'payment' | 'cancel'; key: string } | null>(null);
  const [collect, setCollect] = useState(true);
  const [fee, setFee] = useState('0');
  const [reason, setReason] = useState('');
  const [refundReady, setRefundReady] = useState(false);
  async function load() {
    try {
      const response = await fetch(`/api/pos/laybys?closed=${closed ? '1' : '0'}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setLaybys(data.laybys);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not load laybys.'); }
  }
  useEffect(() => { void load(); }, [closed]);
  function receipt(transaction: any) {
    const sale = transaction.sale;
    onReceipt({ ...sale, id: sale.id, local_id: sale.local_id, location_name: session.location_name, cashier_name: sale.cashier_name ?? session.full_name,
      subtotal: Number(sale.subtotal), discount_total: Number(sale.discount_total), total: Number(sale.total), tax_total: Number(sale.tax_total),
      items: transaction.items.map((item: any) => ({ ...item, localId: String(item.id), qty: Number(item.qty), unit_price: Number(item.unit_price), line_total: Number(item.line_total) })),
      payments: transaction.payments.map((payment: any) => ({ localId: String(payment.id), method: payment.payment_method, amount: Number(payment.amount), reference: payment.reference ?? '' })),
    });
  }
  async function recoverOpening() {
    if (busyRef.current || !opening) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/pos/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opening) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const transaction = await fetch(`/api/pos/sales/${data.id}`);
      if (!transaction.ok) throw new Error('The layby is saved, but its receipt could not be loaded. Retry the saved request.');
      receipt(await transaction.json());
      localStorage.removeItem(openingKey);
      setOpening(null);
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The opening deposit could not be confirmed. Retry without charging again.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function act(layby: Layby, action: string, key: string, payments: PaymentEntry[] = [], retry?: PendingAction) {
    if (busyRef.current || (pending && !retry)) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const paidNow = payments.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0);
      const fullyPaid = Math.round(Number(layby.paid_total) * 100) + paidNow === Math.round(Number(layby.total) * 100);
      const next = retry ?? { layby: { ...layby, customer_name: '' }, body: { sale_id: layby.id, action, operation_key: key,
        payments: payments.map(payment => ({ payment_method: payment.method, amount: payment.amount, reference: payment.reference })), collect: collect && fullyPaid,
        fee_override: action === 'cancel' ? Number(fee) : undefined, reason: action === 'cancel' ? reason : undefined } };
      setPending(next);
      localStorage.setItem(storageKey, JSON.stringify(next));
      setSelected(null);
      setRefundReady(false);
      const response = await fetch('/api/pos/laybys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next.body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      localStorage.removeItem(storageKey);
      setPending(null);
      setSelected(null);
      setRefundReady(false);
      await load();
      if (data.transaction && action !== 'adopt') receipt(data.transaction);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The action could not be confirmed. Retry without charging again.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  let cancellation: ReturnType<typeof planLaybyCancellation> | null = null;
  if (selected?.action === 'cancel') {
    try { cancellation = planLaybyCancellation({ total: Number(selected.layby.total), paid: Number(selected.layby.paid_total), feePercent: Number(selected.layby.fee_percent), overrideFee: Number(fee), reason }); }
    catch { cancellation = null; }
  }
  return <main style={{ padding: 20, maxWidth: 1000, margin: '0 auto', color: 'var(--sv-text-main)' }}>
    <header style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
      <button onClick={onBack} style={button}><ArrowLeft size={18} />POS</button><h1 style={{ fontSize: 22, margin: 0, flex: 1 }}>Laybys</h1>
      <button onClick={() => void load()} style={button} title='Refresh laybys' aria-label='Refresh laybys'><RefreshCw size={18} /></button>
    </header>
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
      <input aria-label='Find layby' placeholder='Customer or layby number' value={search} onChange={event => setSearch(event.target.value)} style={{ padding: 10, border: '1px solid var(--sv-etch)', borderRadius: 4, minWidth: 220, flex: 1 }} />
      <label><input type='checkbox' checked={closed} onChange={event => setClosed(event.target.checked)} /> Include collected and cancelled</label>
    </div>
    {error && <p role='alert' style={{ color: 'var(--sv-red)' }}>{error}</p>}
    {opening && <div role='alert' style={{ padding: '12px 0', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><strong>Opening deposit awaiting confirmation</strong><button disabled={busy} style={button} onClick={() => void recoverOpening()}><RefreshCw size={16} />Retry saved deposit</button></div>}
    {pending && <div role='alert' style={{ padding: '12px 0', borderBottom: '1px solid var(--sv-etch)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><strong>Layby #{pending.layby.id}: action awaiting confirmation</strong><button disabled={busy} style={button} onClick={() => void act(pending.layby, String(pending.body.action), String(pending.body.operation_key), [], pending)}><RefreshCw size={16} />Retry saved action</button></div>}
    {laybys.filter(layby => `${layby.id} ${layby.customer_name}`.toLowerCase().includes(search.toLowerCase())).map(layby => <article key={layby.id} style={{ padding: '16px 0', borderBottom: '1px solid var(--sv-etch)', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}><strong>#{layby.id} · {layby.customer_name}</strong><div style={{ marginTop: 4, fontSize: 14 }}>{layby.layby_state === 'cancelled' ? <>Refunded ${money(Number(layby.paid_total) - Number(layby.retained_fee))} · Retained fee ${money(layby.retained_fee)}</> : <>Total ${money(layby.total)} · Paid ${money(layby.paid_total)} · Owing ${money(Math.max(0, Number(layby.total) - Number(layby.paid_total)))}</>}</div><div style={{ fontSize: 13, marginTop: 4 }}>{({ active: 'Active', paid: 'Fully paid · awaiting collection', collected: 'Collected', cancelled: 'Cancelled', legacy: 'Reservation required' } as Record<string, string>)[layby.layby_state]}</div></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {layby.layby_state === 'legacy' && <button disabled={busy || !!pending} style={button} onClick={() => void act(layby, 'adopt', `adopt:${layby.id}`)}><PackageCheck size={16} />Reserve</button>}
        {layby.layby_state === 'active' && <button disabled={busy || !!pending} style={button} onClick={() => { setError(''); setCollect(true); setSelected({ layby, action: 'payment', key: crypto.randomUUID() }); }}><Banknote size={16} />Add payment</button>}
        {layby.layby_state === 'paid' && <button disabled={busy || !!pending} style={button} onClick={() => { if (window.confirm(`Collect goods for layby #${layby.id}?`)) void act(layby, 'collect', `collect:${layby.id}`); }}><PackageCheck size={16} />Collect</button>}
        {['active', 'paid'].includes(layby.layby_state) && <button disabled={busy || !!pending} style={button} onClick={() => { setError(''); setFee(money(Math.min(Number(layby.paid_total), Number(layby.total) * Number(layby.fee_percent) / 100))); setReason(''); setRefundReady(false); setSelected({ layby, action: 'cancel', key: crypto.randomUUID() }); }}><X size={16} />Cancel layby</button>}
        <button disabled={busy} style={button} title='Print layby receipt' aria-label={`Print layby ${layby.id}`} onClick={async () => { const response = await fetch(`/api/pos/sales/${layby.id}`); if (response.ok) receipt(await response.json()); else setError('Could not load the receipt.'); }}><Printer size={16} /></button>
      </div>
      {layby.layby_state !== 'legacy' && <small style={{ width: '100%', color: layby.accounting_status === 'error' ? 'var(--sv-red)' : 'var(--sv-text-dim)' }}>Xero: {layby.accounting_status === 'error' ? 'Posting failed' : layby.accounting_status === 'posted' ? 'Posted' : 'Pending'}</small>}
    </article>)}
    {!laybys.length && <p>No laybys.</p>}
    {selected?.action === 'payment' && <>
      {renderPayment({ total: Number(selected.layby.total) - Number(selected.layby.paid_total), isLayby: true, error,
        extraContent: <label style={{ display: 'block', marginBottom: 12 }}><input type='checkbox' checked={collect} onChange={event => setCollect(event.target.checked)} /> Collect when fully paid</label>,
        onComplete: payments => void act(selected.layby, 'payment', selected.key, payments), onCancel: () => { if (!busy) setSelected(null); } })}
    </>}
    {selected?.action === 'cancel' && !refundReady && <div role='dialog' aria-label='Cancel layby' style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.55)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ padding: 24, maxWidth: 420, width: '100%', background: 'var(--sv-bg-1)', borderRadius: 8 }}><h2 style={{ fontSize: 20 }}>Cancel #{selected.layby.id}</h2>
        <p>Payments received: ${money(selected.layby.paid_total)} · Fee rate: {Number(selected.layby.fee_percent)}%</p>
        <label>Retained fee $<input aria-label='Retained cancellation fee' type='number' min='0' max={Number(selected.layby.paid_total)} step='0.01' value={fee} onChange={event => setFee(event.target.value)} style={{ display: 'block', padding: 8, width: '100%' }} /></label>
        <label>Override reason<input aria-label='Cancellation fee override reason' value={reason} onChange={event => setReason(event.target.value)} style={{ display: 'block', padding: 8, width: '100%', marginBottom: 12 }} /></label>
        <p>Refund due: ${money(cancellation?.refund ?? 0)}</p>
        <div style={{ display: 'flex', gap: 8 }}><button disabled={busy} style={button} onClick={() => setSelected(null)}>Back</button><button disabled={busy || !cancellation} style={button} onClick={() => { if (cancellation?.refund) setRefundReady(true); else void act(selected.layby, 'cancel', selected.key); }}>{cancellation?.refund ? 'Record refund' : 'Confirm cancellation'}</button></div>
      </div>
    </div>}
    {selected?.action === 'cancel' && refundReady && cancellation && renderPayment({ total: -cancellation.refund, isLayby: false, error,
      onComplete: payments => void act(selected.layby, 'cancel', selected.key, payments), onCancel: () => { if (!busy) setRefundReady(false); } })}
  </main>;
}