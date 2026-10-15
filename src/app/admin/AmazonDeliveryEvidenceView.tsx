'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DELIVERY_VOID_REASONS, MANUAL_DELIVERY_BASES, validateDeliveryEvidenceReport, validateManualDeliveryRequest,
  type AmazonDeliveryEvidenceReport,
} from '@/lib/securityCompliance/amazonDeliveryEvidence';
import styles from './SecurityComplianceView.module.css';

const endpoint = '/api/admin/security-compliance/amazon-delivery-evidence';
async function readResult(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid delivery evidence response.');
  const result = body as Record<string, unknown>;
  if (!response.ok || result.success !== true) throw new Error(typeof result.error === 'string' ? result.error : 'Delivery evidence request failed.');
  return result;
}

export default function AmazonDeliveryEvidenceView({ onHelp }: { onHelp: () => void }) {
  const [orderId, setOrderId] = useState('');
  const [report, setReport] = useState<AmazonDeliveryEvidenceReport | null>(null);
  const [parcelId, setParcelId] = useState('');
  const [deliveredAt, setDeliveredAt] = useState('');
  const [basis, setBasis] = useState<string>(MANUAL_DELIVERY_BASES[0]);
  const [reference, setReference] = useState('');
  const [verified, setVerified] = useState(false);
  const [voidId, setVoidId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState<string>(DELIVERY_VOID_REASONS[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef<AbortController | null>(null);
  const operation = useRef<{ fingerprint: string; key: string } | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function load() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setReport(null); setError(''); setNotice(''); setVoidId(null);
    try {
      if (!/^[1-9]\d*$/.test(orderId) || !Number.isSafeInteger(Number(orderId))) throw new Error('Enter a local Amazon sales order ID.');
      const result = await readResult(await fetch(`${endpoint}?salesOrderId=${orderId}`, { cache: 'no-store', signal: controller.signal }));
      const loaded = validateDeliveryEvidenceReport(result.report);
      if (loaded.salesOrderId !== Number(orderId)) throw new Error('A different Amazon order was returned.');
      if (!controller.signal.aborted) {
        setReport(loaded); setParcelId(''); setVerified(false); setDeliveredAt(''); setReference('');
      }
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Delivery evidence could not be loaded.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  async function save(action: 'record' | 'void') {
    if (!report) return;
    const input = action === 'record'
      ? { action, salesOrderId: report.salesOrderId, parcelId: parcelId ? Number(parcelId) : null, deliveredAt, basis, reference, verified }
      : { action, salesOrderId: report.salesOrderId, evidenceId: voidId, reason: voidReason };
    const fingerprint = JSON.stringify(input);
    if (operation.current?.fingerprint !== fingerprint) operation.current = { fingerprint, key: crypto.randomUUID() };
    const body = { ...input, operationKey: operation.current.key };
    try { validateManualDeliveryRequest(body); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Check the verification fields.'); return; }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await readResult(await fetch(endpoint, {
        method: 'POST', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }));
      if (typeof result.evidenceId !== 'number' || !Number.isSafeInteger(result.evidenceId) || result.evidenceId <= 0) {
        throw new Error('The save result could not be confirmed.');
      }
      if (!controller.signal.aborted) {
        setNotice(`Saved evidence record #${result.evidenceId}. Reload this order and run the inventory again to see the updated deadline.`);
        setReport(null); setVoidId(null);
      }
    } catch (caught) {
      if (!controller.signal.aborted) setError(`${caught instanceof Error ? caught.message : 'The save could not be confirmed.'} Reload the evidence history before changing or resubmitting details.`);
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <section className={styles.card} aria-labelledby="amazon-delivery-evidence-title">
    <div className={styles.heading}>
      <div><h2 id="amazon-delivery-evidence-title">Amazon delivery evidence</h2>
        <p>Original buyer delivery only, for the active business. No stock, order status, customer details or PII disposal is changed.</p></div>
      <button type="button" onClick={onHelp}>Delivery evidence help</button>
    </div>
    <p>Automatic tracking supports dispatched Australia Post eParcel articles prepared in Solvantis. Enable Amazon delivery tracking for the active business in IMS Settings &gt; Shipping. The hourly Online channel delivery tracking job starts Off in Admin &gt; Cron Jobs; enable it only after storage and tracking access are verified. Missing article IDs, unsupported carriers and unavailable tracking require manual verification, not an assumed delivery date. This review and the 30-day PII rules remain Amazon-only.</p>
    <form onSubmit={event => { event.preventDefault(); void load(); }}>
      <label className={styles.role}>Local Amazon sales order ID
        <input inputMode="numeric" value={orderId} disabled={busy} onChange={event => { setOrderId(event.target.value); setReport(null); setVoidId(null); setNotice(''); }} required />
      </label>
      <div className={styles.actions}><button type="submit" disabled={busy}>Load delivery evidence</button></div>
    </form>
    {busy && <p role="status">Processing delivery evidence...</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    {report && <>
      <h3>Sales order #{report.salesOrderId}</h3>
      <p>Earliest verified delivery: {report.earliestVerifiedDeliveryAt ?? 'Not recorded'}. Review deadline: {report.reviewDeadlineAt ?? 'Not assessable'}.</p>
      <p>Split shipments use the earliest verified parcel delivery, not the last parcel or polling date. Missing delivery evidence does not authorize indefinite retention. A recorded parcel is not confirmation that the entire order was delivered.</p>
      <h3>Known dispatched parcels</h3>
      {!report.parcels.length ? <p>No prepared, dispatched parcel records are available. Verify the order&apos;s first original buyer delivery manually using independent evidence.</p>
        : <ul>{report.parcels.map(parcel => <li key={parcel.id}>Parcel #{parcel.id} (shipment #{parcel.shipmentId}, parcel {parcel.parcelNumber}): {parcel.automaticTracking ? 'Australia Post article available' : 'Manual verification required'}.
          {' '}Last check: {parcel.lastCheckedAt ?? 'Not checked'}; outcome: {parcel.outcome ?? 'Not recorded'}.</li>)}</ul>}
      <h3>Manual verification fallback</h3>
      <form onSubmit={event => { event.preventDefault(); void save('record'); }}>
        <fieldset className={styles.roles} disabled={busy}>
          <legend className={styles.srOnly}>Verify original Amazon buyer delivery</legend>
          <label className={styles.role}>Evidence scope
            <select value={parcelId} onChange={event => setParcelId(event.target.value)}>
              <option value="">Order&apos;s first original buyer delivery</option>
              {report.parcels.map(parcel => <option key={parcel.id} value={parcel.id}>Parcel #{parcel.id}</option>)}
            </select>
          </label>
          <label className={styles.role}>Verified delivery timestamp
            <input value={deliveredAt} onChange={event => setDeliveredAt(event.target.value)} placeholder="2026-10-15T14:43:09+11:00" required />
            <small>Use the actual evidence date and explicit timezone, for example +11:00 or Z. Never use a return, shipping or order date.</small>
          </label>
          <label className={styles.role}>Verification source
            <select value={basis} onChange={event => setBasis(event.target.value)}>
              {MANUAL_DELIVERY_BASES.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className={styles.role}>Non-personal evidence code
            <input value={reference} onChange={event => setReference(event.target.value)} placeholder="TICKET-123" maxLength={107} required />
            <small>Use TICKET-, CARRIER-, AMAZON- or RECORD- followed by a record code. No buyer details, URLs, credentials, screenshots or raw carrier responses.</small>
          </label>
        </fieldset>
        <label className={styles.acknowledgement}>
          <input type="checkbox" checked={verified} disabled={busy} onChange={event => setVerified(event.target.checked)} />
          I independently verified original buyer delivery for this scope; for an order, this is the first delivery.
        </label>
        <div className={styles.actions}><button type="submit" disabled={busy || !verified}>Save verified delivery</button></div>
      </form>
      <h3>Evidence history</h3>
      <p>Records are append-only. Voiding incorrect manual evidence adds a correction with your signed-in account; it does not erase history. Carrier evidence cannot be voided here; investigate suspected errors in Runtime Issues before any disposal action.</p>
      {report.hasMoreHistory && <p>Showing the latest 50 records. The deadline uses all active evidence, not just this history page.</p>}
      {!report.history.length ? <p>No verified delivery evidence recorded.</p> : <ul className={styles.inventoryList}>
        {report.history.map(entry => <li key={entry.id}>
          <strong>Evidence #{entry.id}: {entry.kind === 'void' ? `Correction for #${entry.voidsEvidenceId}` : entry.active ? 'Active' : 'Voided'}</strong>
          <p>{entry.parcelId === null ? 'Order first delivery' : `Parcel #${entry.parcelId}`} | {entry.source === 'auspost' ? 'Australia Post article event' : `Manual: ${entry.basis}`}
            {' '}| Delivery: {entry.deliveredAt ?? 'Correction only'} | Recorded: {entry.recordedAt}
            {' '}| {entry.actorUserId === null ? 'System' : `Verified actor user #${entry.actorUserId}`}</p>
          {entry.source === 'manual' && <p>Evidence reference: {entry.reference}</p>}
          {entry.source === 'manual' && entry.active && <button type="button" disabled={busy} onClick={() => setVoidId(entry.id)}>Void incorrect manual evidence #{entry.id}</button>}
        </li>)}
      </ul>}
      {voidId !== null && <div className={styles.warning}>
        <p>Void manual evidence #{voidId} only if it is factually incorrect. This may change the review deadline; the original and correction remain in history. It does not authorize an exception to the 30-day policy.</p>
        <label className={styles.role}>Correction reason<select disabled={busy} value={voidReason} onChange={event => setVoidReason(event.target.value)}>
          {DELIVERY_VOID_REASONS.map(reason => <option key={reason} value={reason}>{reason}</option>)}
        </select></label>
        <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={() => void save('void')}>Confirm factual correction</button>
          <button type="button" disabled={busy} onClick={() => setVoidId(null)}>Cancel correction</button>
        </div>
      </div>}
    </>}
  </section>;
}
