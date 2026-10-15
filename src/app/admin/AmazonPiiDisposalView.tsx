'use client';

import { useEffect, useRef, useState } from 'react';
import { AMAZON_PII_COPY_WARNING, validateAmazonPiiDisposalPreview, type AmazonPiiDisposalPreview } from '@/lib/securityCompliance/amazonPiiDisposal';
import styles from './SecurityComplianceView.module.css';

const endpoint = '/api/admin/security-compliance/amazon-pii-disposal';
async function result(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid cleanup response.');
  const data = body as Record<string, unknown>;
  if (!response.ok || data.success !== true) throw new Error(typeof data.error === 'string' ? data.error : 'Cleanup request failed.');
  return data;
}

export default function AmazonPiiDisposalView({ onHelp }: { onHelp: () => void }) {
  const [orderId, setOrderId] = useState('');
  const [preview, setPreview] = useState<AmazonPiiDisposalPreview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef<AbortController | null>(null);
  const operation = useRef<string | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function load() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setError(''); setNotice(''); setPreview(null); setConfirmation(''); operation.current = null;
    try {
      if (!/^[1-9]\d*$/.test(orderId) || !Number.isSafeInteger(Number(orderId))) throw new Error('Enter a local Amazon sales order ID.');
      const data = await result(await fetch(`${endpoint}?salesOrderId=${orderId}`, { cache: 'no-store', signal: controller.signal }));
      const report = validateAmazonPiiDisposalPreview(data.report);
      if (report.salesOrderId !== Number(orderId)) throw new Error('A different order was returned.');
      if (!controller.signal.aborted) setPreview(report);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Preview failed.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  async function approve() {
    if (!preview || preview.alreadyCleared || preview.blockers.length || confirmation !== `CLEAR AMAZON PII ${preview.salesOrderId}`) return;
    setBusy(true); setError(''); setNotice('');
    operation.current ??= crypto.randomUUID();
    const controller = new AbortController();
    pending.current = controller;
    try {
      const data = await result(await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({
          expectedBusinessId: preview.businessId, salesOrderId: preview.salesOrderId,
          token: preview.token, expiresAt: preview.expiresAt, operationKey: operation.current, confirmation,
        }),
      }));
      const saved = data.result;
      if (!saved || typeof saved !== 'object' || !('salesOrderId' in saved)
        || saved.salesOrderId !== preview.salesOrderId || !('structuredFieldsCleared' in saved) || saved.structuredFieldsCleared !== true
        || !('copyReviewRequired' in saved) || saved.copyReviewRequired !== true) throw new Error('Cleanup completion could not be verified. Reload the preview.');
      if (!controller.signal.aborted) {
        setPreview({ ...preview, alreadyCleared: true, fieldsToClear: [] }); setConfirmation('');
        setNotice('Identifying fields cleared. Necessary order and financial history remains; separate copy review is still required.');
      }
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Cleanup completion could not be verified.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <section className={styles.card} aria-labelledby="amazon-pii-disposal-title">
    <div className={styles.heading}>
      <h2 id="amazon-pii-disposal-title">Amazon identifying-field cleanup</h2>
      <button type="button" aria-label="Amazon cleanup help" onClick={onHelp}>Help</button>
    </div>
    <p>Preview one order in the active business. No automatic deletion or polling is enabled by this workflow.</p>
    <p>30 days after verified delivery is the maximum retention deadline, not a required waiting period. Earlier approved cleanup is allowed once delivery and operational checks are satisfied.</p>
    <p className={styles.warning}>{AMAZON_PII_COPY_WARNING}</p>
    <div className={styles.actions}>
      <label>Local Amazon sales order ID <input type="text" inputMode="numeric" value={orderId} disabled={busy}
        onChange={event => { setOrderId(event.target.value); setPreview(null); setConfirmation(''); setNotice(''); }} /></label>
      <button type="button" disabled={busy} onClick={() => void load()}>{busy ? 'Working...' : 'Preview cleanup'}</button>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    {preview && <>
      <p>Amazon reference: {preview.amazonOrderReference || 'Unverified'}.
        Deadline: {preview.deadlineAt ? new Date(preview.deadlineAt).toLocaleString('en-AU') : 'Delivery evidence required'}.</p>
      {preview.alreadyCleared ? <p role="status">Structured identifying fields have already been cleared. This is not certification that all copies are removed.</p> : <>
        <ul>{preview.fieldsToClear.map(item => <li key={item.source}>{item.source}: {item.fields} fields/links across {item.records} records.</li>)}</ul>
        <p>Names, email, phone and address fields are targeted. Notes, product descriptions, quantities, amounts, stock and customer/ledger ownership are not changed.</p>
        {preview.blockers.length > 0 ? <div role="alert"><strong>Cleanup blocked</strong><ul>{preview.blockers.map(item => <li key={item}>{item}</li>)}</ul></div> : <>
          <p>Approval permanently clears the listed fields and disables old in-app label access. The preview expires after 15 minutes; changed records require a fresh preview.</p>
          <label>Type CLEAR AMAZON PII {preview.salesOrderId}
            <input type="text" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} />
          </label>
          <button type="button" disabled={busy || confirmation !== `CLEAR AMAZON PII ${preview.salesOrderId}`} onClick={() => void approve()}>Approve identifying-field cleanup</button>
        </>}
      </>}
    </>}
  </section>;
}
