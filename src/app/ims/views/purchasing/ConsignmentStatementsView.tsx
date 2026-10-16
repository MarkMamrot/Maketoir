'use client';

import { useEffect, useRef, useState } from 'react';
import { useFeatureEnabled } from '../../components/FeatureToggleProvider';
import { SBDatePicker, type SBDateRange } from '../reports/reportFilterHelpers';
import { previousCalendarPeriod } from '../reports/reportFilterUtils';
import { ConsignmentTable } from './ConsignmentTable';
import { consignmentApi } from './consignmentApi';

interface Statement {
  id: number; number: string; supplier_id: number; period_from: string; period_to: string;
  status: 'Draft' | 'Finalised' | 'Accounted' | 'Cancelled'; total: number; version: number;
  currency?: string; accounting_reference?: string; accounting_date?: string;
  snapshot_json?: { supplier?: { name?: string }; business?: { name?: string }; guidance?: string };
}
interface Detail {
  statement: Statement;
  events: Record<string, unknown>[];
  projection: {
    rows: { sku: string; productName: string; quantitySold: number; quantityRefunded: number; quantityAdjusted?: number; netQuantity: number; unitCost: number | null; taxRate: number | null; subtotal: number; tax: number; total: number }[];
    exceptions: { eventId: number; message: string }[];
  };
  audit: Record<string, unknown>[];
  deliveries: Record<string, unknown>[];
  priorUnallocated?: {
    events: Record<string, unknown>[]; totals: { subtotal: number; tax: number; total: number };
    exceptions: { eventId: number; message: string }[]; label: string; includedInDraft: boolean;
  };
}

export function ConsignmentStatementsView({ canManage }: { canManage: boolean }) {
  const tracking = useFeatureEnabled('feature_toggle_consignment_tracking');
  const [statements, setStatements] = useState<Statement[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [range, setRange] = useState<SBDateRange>(() => previousCalendarPeriod('month'));
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [carry, setCarry] = useState(false);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [accountingDate, setAccountingDate] = useState('');
  const [recipient, setRecipient] = useState('');
  const [sendAck, setSendAck] = useState(false);
  const sendAttempt = useRef<{ statementId: number; recipient: string; key: string } | null>(null);
  const [resendAck, setResendAck] = useState(false);
  const [deliveryReason, setDeliveryReason] = useState('');
  const [resolveId, setResolveId] = useState('');
  const [resolveOutcome, setResolveOutcome] = useState('Failed');
  const [providerReference, setProviderReference] = useState('');
  const [resolveAck, setResolveAck] = useState(false);
  const [correctionId, setCorrectionId] = useState('');
  const [correctionQuantity, setCorrectionQuantity] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showSources, setShowSources] = useState(false);
  const [sourcePeriod, setSourcePeriod] = useState('all');
  const editable = tracking && canManage;
  const hasSent = detail?.deliveries.some(delivery => delivery.status === 'Sent') ?? false;
  const unresolved = detail?.deliveries.filter(delivery => ['Sending', 'Unconfirmed'].includes(String(delivery.status))) ?? [];
  const load = async () => setStatements(await consignmentApi<Statement[]>('statements'));
  useEffect(() => {
    load().catch(cause => setError(cause instanceof Error ? cause.message : 'Could not load statements.'));
    fetch('/api/ims/contacts?type=supplier').then(r => r.json()).then(result => {
      if (!result.success) throw new Error('Supplier list unavailable.');
      setSuppliers(result.data);
    }).catch(() => setError('Supplier list unavailable. Reload to retry.'));
  }, []);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await operation(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed. Reload the statement before retrying.'); }
    finally { setBusy(false); }
  };
  const open = (id: number) => run(async () => { setDetail(await consignmentApi<Detail>(`statements/${id}`)); setReason(''); setReference(''); setSendAck(false); setResendAck(false); setResolveAck(false); });
  const action = (value: string) => run(async () => {
    if (!detail) return;
    const result = await consignmentApi<Detail>(`statements/${detail.statement.id}`, {
      action: value, version: detail.statement.version, reason, accountingReference: reference, accountingDate,
    }, 'PATCH');
    setDetail(result); setMessage('Statement updated.');
  });
  return <section style={{ minWidth: 0, width: '100%', maxWidth: '100%' }}>
    <h1>Consignment Statements</h1>
    <p>Statements are supplier settlement records, not purchase orders or payments. Accounted means recorded externally; it does not mean paid and does not create a Xero bill.</p>
    <p>Record supplier cost once externally: normally a supplier bill to your bookkeeper&apos;s agreed cost-of-sales account, then pay the bill. If using a direct bank expense instead, do not also enter a bill. The bill normally records expense; payment clears the payable. A statement is not a tax invoice. Follow your bookkeeper&apos;s GST, invoice-evidence and timing requirements.</p>
    {!tracking && <p role="status">Tracking is off. Historical statements are read-only. Use Consignment Activity for period reporting.</p>}
    {editable && !detail && <section aria-label="Create consignment draft">
      <h2>Create Draft</h2>
      <label>Supplier <select value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">Choose supplier</option>{suppliers.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
      <SBDatePicker value={range} onChange={setRange} />
      <label><input type="checkbox" checked={carry} onChange={e => setCarry(e.target.checked)} />Include eligible earlier unassigned activity (carryforward)</label>
      <button disabled={busy || !supplierId || range.kind !== 'range'} onClick={() => void run(async () => {
        if (range.kind !== 'range') return;
        setDetail(await consignmentApi<Detail>('statements', { supplierId: Number(supplierId), from: range.from, to: range.to, includeCarryForward: carry }));
      })}>Create Draft</button>
      {range.kind !== 'range' && <p>Choose a calendar period or custom date range for a statement.</p>}
    </section>}
    {error && <p role="alert">{error} No automatic retry was performed. Reload before retrying a version conflict.</p>}
    {message && <p role="status">{message}</p>}
    {busy && <p role="status">Working…</p>}
    {!detail ? <ConsignmentTable headings={['Statement', 'Supplier', 'From', 'To', 'Status', 'Total', 'Version']}
      rows={statements.map(item => [<button key={item.id} disabled={busy} onClick={() => void open(item.id)}>{item.number}</button>, suppliers.find(s => s.id === item.supplier_id)?.name || item.supplier_id, String(item.period_from).slice(0, 10), String(item.period_to).slice(0, 10), item.status, Number(item.total).toFixed(2), item.version])} /> : <>
      <button onClick={() => setDetail(null)}>Back to statements</button>
      <h2>{detail.statement.number} — {detail.statement.status}</h2>
      <p>Version {detail.statement.version} · Total ${Number(detail.statement.total).toFixed(2)}</p>
      <p>{detail.statement.snapshot_json?.business?.name} · {detail.statement.snapshot_json?.supplier?.name || suppliers.find(s => s.id === detail.statement.supplier_id)?.name}
        {' · '}{String(detail.statement.period_from).slice(0, 10)} to {String(detail.statement.period_to).slice(0, 10)} · {detail.statement.currency || 'AUD'}</p>
      {detail.statement.accounting_reference && <p>External accounting reference: {detail.statement.accounting_reference} · {String(detail.statement.accounting_date || '').slice(0, 10)}. Payment status is not tracked.</p>}
      {Number(detail.statement.total) <= 0 && <p>A zero or negative statement remains evidence. Review carryforward or manual supplier-credit treatment with your bookkeeper; do not enter a negative supplier bill or count these reserved events again.</p>}
      {!!detail.priorUnallocated?.events.length && <section aria-label="Earlier unallocated activity">
        <h3>Earlier eligible unallocated activity</h3>
        <p>{detail.priorUnallocated.label} · Ex tax ${Number(detail.priorUnallocated.totals.subtotal).toFixed(2)} · GST ${Number(detail.priorUnallocated.totals.tax).toFixed(2)} · Total ${Number(detail.priorUnallocated.totals.total).toFixed(2)}.</p>
        <p>{detail.priorUnallocated.includedInDraft ? 'Included by your explicit carryforward choice.' : 'Not included in this statement. To include it, create a new Draft with carryforward selected; cancel an unwanted existing Draft first.'}</p>
        <details><summary>Review earlier source events</summary><ul>{detail.priorUnallocated.events.map(event => <li key={String(event.id)}>{String(event.event_date)} · {String(event.sku || '')} · {String(event.source_type)} {String(event.source_id)} · Quantity {String(event.quantity)}</li>)}</ul></details>
        {!!detail.priorUnallocated.exceptions.length && <ul>{detail.priorUnallocated.exceptions.map((item, index) => <li key={index}>Event {item.eventId}: {item.message}</li>)}</ul>}
      </section>}
      <button disabled={busy} onClick={() => void open(detail.statement.id)}>Reload statement</button>{' '}
      <a href={`/api/ims/consignment/statements/${detail.statement.id}/export?format=csv`} download>Export CSV</a>{' '}
      <a href={`/api/ims/consignment/statements/${detail.statement.id}/export?format=pdf`} download>Export PDF</a>
      {!!detail.projection.exceptions.length && <ul role="alert">{detail.projection.exceptions.map((item, index) => <li key={index}>Event {item.eventId}: {item.message}</li>)}</ul>}
      <div><button aria-pressed={!showSources} onClick={() => setShowSources(false)}>Supplier cost summary</button><button aria-pressed={showSources} onClick={() => setShowSources(true)}>Included source activity</button></div>
      {showSources && <label>Source period <select value={sourcePeriod} onChange={e => setSourcePeriod(e.target.value)}><option value="all">All included activity</option><option value="period">Selected period only</option><option value="earlier">Earlier carryforward only</option></select></label>}
      {!showSources ? <ConsignmentTable key="summary" headings={['SKU', 'Product', 'Sold', 'Refunded', 'Adjusted', 'Net', 'Unit cost', 'Tax rate', 'Ex tax', 'GST', 'Total']}
        rows={detail.projection.rows.map(row => [row.sku, row.productName, row.quantitySold, row.quantityRefunded, row.quantityAdjusted ?? 0, row.netQuantity, row.unitCost ?? 'Missing', row.taxRate ?? 'Missing', row.subtotal, row.tax, row.total])} /> :
      <ConsignmentTable key="sources" headings={['Event', 'Date', 'SKU', 'Kind', 'Source / line', 'Location', 'Channel', 'Original event', 'Quantity', 'Captured unit cost']}
        rows={detail.events.filter(event => sourcePeriod === 'all' || (sourcePeriod === 'earlier' ? String(event.event_date).slice(0, 10) < detail.statement.period_from : String(event.event_date).slice(0, 10) >= detail.statement.period_from))
          .map(event => [String(event.id ?? ''), String(event.event_date ?? ''), String(event.sku ?? ''), String(event.source_type ?? ''), `${event.source_id ?? ''} / ${event.source_line_id ?? ''}`, String(event.location_id ?? ''), String(event.channel ?? ''), String(event.original_event_id ?? '—'), String(event.quantity ?? ''), event.unit_cost == null ? 'Missing' : String(event.unit_cost)])} />}
      {!!detail.events.filter(event => String(event.event_date).slice(0, 10) < detail.statement.period_from).length && <p>Carryforward is included: source rows dated before the selected period are earlier eligible activity from this tracking interval, not pre-cutover debt.</p>}
      {editable && detail.statement.status !== 'Cancelled' && <>
        {detail.statement.status === 'Draft' && <><button disabled={busy} onClick={() => void action('refresh')}>Refresh Draft</button><button disabled={busy || detail.projection.exceptions.length > 0} onClick={() => void action('finalise')}>Finalise statement</button></>}
        {detail.statement.status === 'Finalised' && <div>
          <label>External accounting reference <input value={reference} onChange={e => setReference(e.target.value)} /></label>
          <label>Accounting date <input type="date" value={accountingDate} onChange={e => setAccountingDate(e.target.value)} /></label>
          <button disabled={busy || !reference.trim() || !accountingDate} onClick={() => void action('account')}>Mark Accounted externally</button>
        </div>}
        {detail.statement.status !== 'Accounted' && <div><p>Cancellation releases reservations but does not retract email or undo external accounting. Notify the supplier and bookkeeper if previously shared.</p><label>Cancellation reason <input value={reason} onChange={e => setReason(e.target.value)} /></label><button disabled={busy || !reason.trim()} onClick={() => void action('cancel')}>Cancel statement</button></div>}
        {detail.statement.status === 'Accounted' && <section aria-label="Evidence-backed correction">
          <h3>Create linked correcting Draft</h3>
          <p>The Accounted statement remains unchanged. Corrections require source evidence and a signed quantity; refunds must not be applied twice.</p>
          <SBDatePicker value={range} onChange={setRange} />
          <label>Original event <select value={correctionId} onChange={e => setCorrectionId(e.target.value)}><option value="">Choose event</option>{detail.events.map(event => <option key={String(event.id)} value={String(event.id)}>{String(event.id)} · {String(event.sku || '')}</option>)}</select></label>
          <label>Signed correction quantity <input type="number" step="0.000001" value={correctionQuantity} onChange={e => setCorrectionQuantity(e.target.value)} /></label>
          <label>Correction reason <input value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} /></label>
          <label>Evidence reference <input value={evidence} onChange={e => setEvidence(e.target.value)} /></label>
          <button disabled={busy || !correctionId || !Number(correctionQuantity) || !correctionReason.trim() || !evidence.trim() || range.kind !== 'range'}
            onClick={() => void run(async () => {
              if (range.kind !== 'range') return;
              setDetail(await consignmentApi<Detail>('statements', { supplierId: detail.statement.supplier_id, from: range.from, to: range.to,
                includeCarryForward: false, correction: { originalEventId: Number(correctionId), quantity: Number(correctionQuantity), reason: correctionReason, evidenceReference: evidence } }));
              setCorrectionId(''); setCorrectionQuantity(''); setCorrectionReason(''); setEvidence('');
            })}>Create correcting Draft</button>
        </section>}
        {['Finalised', 'Accounted'].includes(detail.statement.status) && <section aria-label="Email statement">
          <h3>Email statement explicitly</h3>
          <p>Sent means provider accepted, not proof of delivery. An uncertain send must be investigated and resolved before another email can be requested. No email is automatically retried.</p>
          <label>Recipient email <input type="email" value={recipient} onChange={e => setRecipient(e.target.value)} /></label>
          <label><input type="checkbox" checked={sendAck} onChange={e => setSendAck(e.target.checked)} />I confirm the recipient and request sending this statement.</label>
          {hasSent && <><label><input type="checkbox" checked={resendAck} onChange={e => setResendAck(e.target.checked)} />I explicitly request another copy after reviewing prior provider acceptance.</label><label>Resend reason <input value={deliveryReason} onChange={e => setDeliveryReason(e.target.value)} /></label></>}
          <button disabled={busy || !sendAck || !recipient.trim() || !!unresolved.length || (hasSent && (!resendAck || !deliveryReason.trim()))} onClick={() => void run(async () => {
            if (!sendAttempt.current || sendAttempt.current.statementId !== detail.statement.id || sendAttempt.current.recipient !== recipient) {
              sendAttempt.current = { statementId: detail.statement.id, recipient, key: crypto.randomUUID() };
            }
            try {
              await consignmentApi(`statements/${detail.statement.id}/send`, { recipient, acknowledge: true, requestKey: sendAttempt.current.key, ...(hasSent ? { resend: true, reason: deliveryReason } : {}) });
              sendAttempt.current = null; setSendAck(false); setResendAck(false); setMessage('Provider accepted the email. Delivery is unconfirmed; review history.');
            } finally {
              const latest = await consignmentApi<Detail>(`statements/${detail.statement.id}`);
              setDetail(latest);
              if (latest.deliveries[0]?.status === 'Failed') sendAttempt.current = null;
            }
          })}>Send statement email</button>
          {!!unresolved.length && <section aria-label="Resolve uncertain email">
            <h4>Review provider evidence before resolving</h4>
            <label>Unresolved email <select value={resolveId} onChange={e => setResolveId(e.target.value)}><option value="">Choose attempt</option>{unresolved.map(delivery => <option key={String(delivery.id)} value={String(delivery.id)}>{String(delivery.id)} · {String(delivery.status)} · {String(delivery.recipient)}</option>)}</select></label>
            <label>Reviewed outcome <select value={resolveOutcome} onChange={e => setResolveOutcome(e.target.value)}><option value="Failed">Definitely failed</option><option value="Sent">Provider accepted (delivery unconfirmed)</option></select></label>
            <label>Provider reference <input value={providerReference} onChange={e => setProviderReference(e.target.value)} /></label>
            <label>Resolution reason and evidence <input value={deliveryReason} onChange={e => setDeliveryReason(e.target.value)} /></label>
            <label><input type="checkbox" checked={resolveAck} onChange={e => setResolveAck(e.target.checked)} />I reviewed the provider evidence and confirm this outcome.</label>
            <button disabled={busy || !resolveId || !resolveAck || !deliveryReason.trim() || (resolveOutcome === 'Sent' && !providerReference.trim())} onClick={() => void run(async () => {
              await consignmentApi(`statements/${detail.statement.id}/send`, { action: 'resolve', deliveryId: Number(resolveId), outcome: resolveOutcome, providerReference, reason: deliveryReason, acknowledge: true });
              setDetail(await consignmentApi<Detail>(`statements/${detail.statement.id}`)); sendAttempt.current = null; setResolveId(''); setResolveAck(false); setMessage('Reviewed email outcome recorded. No email was sent by resolving it.');
            })}>Record reviewed outcome</button>
          </section>}
        </section>}
      </>}
      <details><summary>Audit history</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(detail.audit, null, 2)}</pre></details>
      <details><summary>Email delivery history</summary>{!detail.deliveries.length ? <p>Not sent</p> : <ul>{detail.deliveries.map(delivery => <li key={String(delivery.id)}>
        {delivery.status === 'Sent' ? 'Provider accepted (delivery unconfirmed)' : String(delivery.status)} · {String(delivery.recipient)} · {String(delivery.created_at)} · Reference: {String(delivery.provider_reference || '—')}
      </li>)}</ul>}</details>
    </>}
  </section>;
}
