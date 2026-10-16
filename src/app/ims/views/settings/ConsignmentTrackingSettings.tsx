'use client';

import { useState } from 'react';
import { consignmentApi } from '../purchasing/consignmentApi';

interface TrackingAudit {
  enabled: boolean;
  evidenceFrom?: string | null;
  intervals?: { id: number; cutover_date: string; enabled_at: string; enabled_by: number | null; disabled_at: string | null; disabled_by: number | null; disable_reason: string | null }[];
  blockers: string[];
  handover: { eventCount: number; subtotal: number; tax: number; total: number };
}

export function ConsignmentTrackingSettings({ enabled, disabled, onChanged }: {
  enabled: boolean; disabled: boolean; onChanged: (enabled: boolean) => void;
}) {
  const [audit, setAudit] = useState<TrackingAudit | null>(null);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const review = async () => {
    setBusy(true); setError(''); setSaved(false); setAck(false);
    try { setAudit(await consignmentApi<TrackingAudit>('tracking')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not review tracking.'); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!audit) return;
    setBusy(true); setError('');
    try {
      await consignmentApi('tracking', audit.enabled
        ? { enabled: false, acknowledgeHandover: ack, reason }
        : { enabled: true, cutoverDate: date, acknowledgeExternal: ack }, 'PUT');
      onChanged(!audit.enabled);
      window.dispatchEvent(new CustomEvent('ims-consignment-tracking-changed', { detail: !audit.enabled }));
      window.dispatchEvent(new Event('solvantis:ims-settings-updated'));
      setAudit(null); setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Tracking transition failed.'); }
    finally { setBusy(false); }
  };
  return <div>
    <button type="button" role="switch" aria-label="Consignment Tracking" aria-checked={enabled}
      disabled={disabled || busy} onClick={() => void review()}>Review {enabled ? 'disable handover' : 'enable cutover'}</button>
    {audit && <section aria-label="Consignment tracking review">
      <p>Tracking is currently {audit.enabled ? 'on' : 'off'}. Basic activity reporting and historical statements remain available.</p>
      {!!audit.blockers.length && <ul role="alert">{audit.blockers.map(item => <li key={item}>{item}</li>)}</ul>}
      {audit.enabled ? <>
        <p>Handover: {audit.handover.eventCount} events; total ${Number(audit.handover.total).toFixed(2)}. Export and reconcile outstanding activity externally before disabling.</p>
        <label>Handover reason <input value={reason} onChange={e => setReason(e.target.value)} /></label>
      </> : <><p>Earliest reliable captured evidence: {audit.evidenceFrom || 'today'}. Use a business-local date; it cannot be in the future or overlap a previous handover.</p><label>Cutover date <input type="date" min={audit.evidenceFrom || undefined} value={date} onChange={e => setDate(e.target.value)} /></label></>}
      <label><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
        {audit.enabled ? 'I acknowledge the external handover and reconciliation responsibility.' : 'I have reconciled pre-cutover activity externally. Tracking will not assume it is unpaid.'}
      </label>
      <button type="button" disabled={busy || !ack || (audit.enabled && !!audit.blockers.length) || (audit.enabled ? !reason.trim() : !date)}
        onClick={() => void apply()}>Confirm {audit.enabled ? 'disable tracking' : 'enable tracking'}</button>
      <button type="button" disabled={busy} onClick={() => setAudit(null)}>Cancel review</button>
      {!!audit.intervals?.length && <details><summary>Tracking interval audit</summary><ul>{audit.intervals.map(interval => <li key={interval.id}>
        Cutover {interval.cutover_date}; enabled {interval.enabled_at} by {interval.enabled_by ?? 'administrator'}.
        {interval.disabled_at ? ` Disabled ${interval.disabled_at} by ${interval.disabled_by ?? 'administrator'}: ${interval.disable_reason || 'External handover'}` : ' Active interval.'}
      </li>)}</ul></details>}
    </section>}
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">Consignment tracking updated.</p>}
  </div>;
}
