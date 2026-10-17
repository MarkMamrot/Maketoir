'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './OnlineSalesRecoveryPanel.module.css';

interface RecoveryStatus {
  mode: 'legacy' | 'validation' | 'cutover';
  paused: boolean;
  channels: Array<{
    channelInstanceId: string;
    displayName: string;
    baselineComplete: boolean;
    coveredThrough: string | null;
    nextCheckAt: string | null;
    safeErrorCode: string | null;
    pendingJobs: number;
    failedJobs: number;
    reviewOrderCount: number;
    reviewOrdersTruncated: boolean;
    reviewOrders: Array<{ externalOrderId: string; reason: string }>;
  }>;
}

function isRecoveryStatus(value: unknown): value is RecoveryStatus {
  if (!value || typeof value !== 'object') return false;
  const status = value as RecoveryStatus;
  const nullableString = (field: unknown) => field === null || typeof field === 'string';
  return ['legacy', 'validation', 'cutover'].includes(status.mode)
    && typeof status.paused === 'boolean'
    && Array.isArray(status.channels)
    && status.channels.every(channel => channel && typeof channel.channelInstanceId === 'string'
      && typeof channel.displayName === 'string' && typeof channel.baselineComplete === 'boolean'
      && nullableString(channel.coveredThrough) && nullableString(channel.nextCheckAt)
      && nullableString(channel.safeErrorCode)
      && Number.isInteger(channel.pendingJobs) && channel.pendingJobs >= 0
      && Number.isInteger(channel.failedJobs) && channel.failedJobs >= 0
      && Array.isArray(channel.reviewOrders)
      && Number.isInteger(channel.reviewOrderCount) && channel.reviewOrderCount >= channel.reviewOrders.length
      && typeof channel.reviewOrdersTruncated === 'boolean'
      && channel.reviewOrders.every(order => order && typeof order.externalOrderId === 'string' && typeof order.reason === 'string'));
}

const recoveryIssueLabels = new Map([
  ['awaiting_reconciliation', 'Awaiting order reconciliation'],
  ['rebaseline_required', 'Baseline refresh required'],
  ['accounting_review_required', 'Accounting review required'],
  ['gift_card_review_required', 'Gift card review required'],
  ['order_review_required', 'Order review required'],
  ['configuration_blocked', 'Recovery configuration needs attention'],
]);

function displayTime(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

export default function OnlineSalesRecoveryPanel({ canManage = false }: { canManage?: boolean }) {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const locked = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/ims/online-sales/recovery', { cache: 'no-store', signal });
    if (!response.ok) throw new Error('status');
    const body: unknown = await response.json();
    if (!isRecoveryStatus(body)) throw new Error('status');
    if (!signal?.aborted) setStatus(body);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(() => {
      if (!controller.signal.aborted) setError('Recovery status could not be loaded. Refresh status to try again.');
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [load]);

  const refresh = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await load();
    } catch {
      setStatus(null);
      setError('Recovery status could not be loaded. Refresh status to try again.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const act = async (action: 'retry' | 'pause' | 'resume', channelInstanceId?: string) => {
    if (locked.current || busy || !canManage || !status || status.mode === 'legacy') return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/ims/online-sales/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(channelInstanceId ? { channelInstanceId } : {}) }),
      });
      if (!response.ok) {
        setError(response.status === 403
          ? 'You do not have permission to change recovery controls.'
          : response.status === 409 && action === 'retry'
            ? 'Recovery is paused. Resume recovery before requesting a retry.'
            : 'Recovery request was not confirmed. Refresh status before trying again.');
      } else {
        setNotice(action === 'retry'
          ? 'Retry requested. Work still needs to complete; posting and review checks still apply.'
          : action === 'pause' ? 'Recovery pause requested.' : 'Recovery resume requested.');
      }
      await load();
    } catch {
      setStatus(null);
      setError('Recovery request or status refresh could not be confirmed. Refresh status before trying again.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const available = status && status.mode !== 'legacy';

  return (
    <section className={styles.panel} aria-label="Online sales recovery" data-help-context="online-sales-recovery" aria-busy={busy}>
      <div className={styles.header}>
        <h2>Online sales recovery</h2>
        <button type="button" disabled={busy} onClick={() => void refresh()}>Refresh recovery status</button>
      </div>
      {busy && !status && <p role="status">Loading recovery status…</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {status?.mode === 'legacy' && (
        <p>Recovery controls are unavailable until rollout. Current order synchronization continues unchanged.</p>
      )}
      {available && <>
        <p>{status.mode === 'validation'
          ? 'Validation: recovery is being checked. Existing catch-up behaviour remains in place until verified cutover.'
          : 'Cutover: bounded scheduled order reconciliation is active. After verified cutover, opening POS or IMS no longer triggers order catch-up.'}</p>
        <p>Webhooks prompt order updates. Daily accounting runs independently of order reconciliation.</p>
        <div className={styles.header}>
          <strong>Scheduled recovery: {status.paused ? 'Paused' : 'Running'}</strong>
          {canManage && <button type="button" disabled={busy} onClick={() => void act(status.paused ? 'resume' : 'pause')}>
            {status.paused ? 'Resume recovery' : 'Pause recovery'}
          </button>}
        </div>
        <p>Pausing recovery does not restore old historical scans. Resume recovery before requesting a retry.</p>
        {!canManage && <p>Only Admins and SuperAdmins can retry, pause or resume recovery. Advisor accounting-sync access does not grant these controls.</p>}
        <p>Baseline completion confirms initial order coverage only, not completion of gift card or accounting work. Baseline completion and incremental coverage are separate. Manual posting stays blocked until baseline and catch-up readiness checks pass, with no override. Retry never clears posted-day review.</p>
        <p>Missing gift card permissions or genuine gift card discrepancies remain failed until an explicit retry after the cause is addressed.</p>
        {status.channels.length === 0 && <p>No online channels are reporting recovery status.</p>}
        <div className={styles.channels}>
          {status.channels.map(channel => (
            <section className={styles.channel} key={channel.channelInstanceId} aria-label={`${channel.displayName} recovery`}>
              <div className={styles.header}>
                <h3>{channel.displayName}</h3>
                {canManage && <button type="button" disabled={busy || status.paused}
                  onClick={() => void act('retry', channel.channelInstanceId)}>Retry recovery for {channel.displayName}</button>}
              </div>
              <dl className={styles.metrics}>
                <div><dt>Baseline</dt><dd>{channel.baselineComplete ? 'Complete' : 'Incomplete — catch-up required'}</dd></div>
                <div><dt>Incremental coverage through</dt><dd>{displayTime(channel.coveredThrough, 'Not yet confirmed')}</dd></div>
                <div><dt>Next scheduled check</dt><dd>{displayTime(channel.nextCheckAt, 'Not scheduled')}</dd></div>
                <div><dt>Queued work</dt><dd>{channel.pendingJobs}</dd></div>
                <div><dt>Failed work</dt><dd>{channel.failedJobs}</dd></div>
                <div><dt>Orders needing review</dt><dd>{channel.reviewOrderCount}</dd></div>
              </dl>
              {channel.safeErrorCode && <p role="status">Recovery issue: {recoveryIssueLabels.get(channel.safeErrorCode) ?? channel.safeErrorCode}</p>}
              {channel.reviewOrderCount > 0 && <>
                {channel.reviewOrdersTruncated && <p>Showing {channel.reviewOrders.length} of {channel.reviewOrderCount} orders needing review. This is not the full review list.</p>}
                <p>Review these orders in Online Sales. Non-refund late changes to an already posted day require review; retry does not approve them.</p>
                <ul>{channel.reviewOrders.map((order, index) => <li key={`${order.externalOrderId}-${index}`}>
                  <strong>{order.externalOrderId}</strong>: {order.reason}
                </li>)}</ul>
              </>}
            </section>
          ))}
        </div>
        <p>Recovered refunds repair local orders and linked credit notes and automatically use the existing Xero flow when eligible. Recovery never charges or refunds the customer again.</p>
      </>}
    </section>
  );
}
