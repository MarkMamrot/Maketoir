'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

export const ONLINE_ORDER_RECOVERY_QUEUED = 'Order import queued for scheduled recovery. Orders have not finished importing; check Online sales recovery for progress.';

export function shopifyOrderImportMessage(result: {
  queued?: boolean;
  error?: string;
  imported?: number;
  confirmed_drafts?: number;
  skipped_existing?: number;
}): string {
  if (result.error) return `✗ ${result.error}`;
  if (result.queued) return `✓ ${ONLINE_ORDER_RECOVERY_QUEUED}`;
  const imported = result.imported ?? 0;
  const confirmed = result.confirmed_drafts ?? 0;
  return `✓ Imported ${imported} order${imported !== 1 ? 's' : ''}${confirmed > 0 ? `, fixed ${confirmed} stuck draft${confirmed !== 1 ? 's' : ''}` : ''} (${result.skipped_existing ?? 0} already existed)`;
}

const readinessLabels = new Map([
  ['paused', 'Recovery is paused. Ask an administrator to resume recovery first.'],
  ['business_automation_paused', 'Business automation is paused.'],
  ['baseline_incomplete', 'Initial order coverage is incomplete.'],
  ['rebaseline_required', 'The initial order coverage needs to be refreshed.'],
  ['reconciliation_incomplete', 'Order catch-up is incomplete.'],
  ['reconciliation_in_progress', 'Order reconciliation is still in progress.'],
  ['reconciliation_configuration_incomplete', 'Order reconciliation configuration needs attention.'],
  ['order_review_required', 'An order requires review. Retrying does not clear that review.'],
  ['accounting_review_required', 'Accounting requires review.'],
  ['gift_card_review_required', 'Gift card activity requires review.'],
  ['native_payment_evidence_incomplete', 'Online payment evidence is incomplete.'],
  ['business_day_open', 'This business day has not closed yet.'],
  ['accounting_job_unavailable', 'Scheduled accounting work is not available yet.'],
]);

export function OnlineDailySalesSyncButton({
  businessId, date, channelInstanceId, initialStatus = 'none', label = 'Sync Xero', disabled = false, style, onRefresh,
}: {
  businessId: string;
  date: string;
  channelInstanceId: string;
  initialStatus?: 'ok' | 'err' | 'none';
  label?: string;
  disabled?: boolean;
  style?: CSSProperties;
  onRefresh?: () => void | Promise<void>;
}) {
  const [status, setStatus] = useState<'ok' | 'err' | 'none' | 'queued' | 'blocked'>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const locked = useRef(false);

  useEffect(() => {
    setStatus(initialStatus);
    setFeedback('');
  }, [businessId, channelInstanceId, date, initialStatus]);

  const sync = async () => {
    if (locked.current || disabled || !channelInstanceId) return;
    locked.current = true;
    setBusy(true);
    setFeedback('');
    try {
      const response = await fetch('/api/xero/sync/daily-sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId: businessId, date, channel: 'online', channelInstanceId }),
      });
      const result = await response.json();
      if (response.ok && result.queued === true) {
        setStatus('queued');
        setFeedback('Daily sales queued for scheduled accounting. Xero posting is not confirmed. Refresh Online Sales or Sync History later to check the result.');
      } else if (response.status === 409) {
        setStatus('blocked');
        const reason = typeof result.reason === 'string' ? result.reason : 'readiness_not_confirmed';
        setFeedback(`Posting blocked: ${readinessLabels.get(reason) ?? 'Readiness checks have not passed.'} (${reason}) Baseline and catch-up readiness checks must pass; there is no override.`);
      } else if (response.ok && response.status !== 202 && result.success === true) {
        setStatus('ok');
        setFeedback('Daily sales posting to Xero completed.');
      } else {
        setStatus(response.ok && response.status !== 202 ? 'none' : 'err');
        setFeedback(response.status === 403 ? 'You do not have permission to sync daily sales.'
          : response.ok && response.status !== 202 && typeof result.message === 'string' ? result.message
            : 'Daily sales posting was not confirmed. Check Sync History before retrying.');
      }
      if (onRefresh && response.ok && response.status !== 202 && result.success === true && !result.queued) {
        try { await onRefresh(); } catch { setFeedback(previous => `${previous} Refresh the view to check its latest status.`); }
      }
    } catch {
      setStatus('err');
      setFeedback('Daily sales request could not be confirmed. Check Sync History before retrying.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const color = status === 'ok' ? 'var(--sv-mint)' : status === 'err' ? 'var(--sv-red)'
    : status === 'queued' || status === 'blocked' ? 'var(--sv-amber, #b45309)' : 'var(--sv-text-muted)';
  return (
    <span data-help-context="online-sales-daily-accounting" style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5, maxWidth: 320 }}>
      <button type="button" disabled={busy || disabled || !channelInstanceId}
        onClick={event => { event.stopPropagation(); void sync(); }}
        title="Request this day's daily accounting. Queued work is not confirmation of Xero posting."
        style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: status === 'ok' ? 'rgba(16,185,129,.1)' : 'none',
          fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', ...style, color }}>
        {busy ? 'Requesting…' : status === 'ok' ? '✓ Xero' : status === 'err' ? '✗ Xero'
          : status === 'queued' ? 'Xero queued' : status === 'blocked' ? 'Xero blocked' : label}
      </button>
      {feedback && <span role={status === 'err' || status === 'blocked' ? 'alert' : 'status'}
        style={{ fontSize: 11, color, whiteSpace: 'normal', textAlign: 'left', lineHeight: 1.5 }}>{feedback}</span>}
    </span>
  );
}
