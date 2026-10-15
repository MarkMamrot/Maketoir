'use client';

import { useEffect, useRef, useState } from 'react';
import { SECURITY_POLICIES } from '@/lib/securityCompliance/policies';
import type { PolicyEvidenceKind, PolicyEvidenceState } from '@/lib/securityCompliance/policyEvidence';
import styles from './SecurityComplianceView.module.css';

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid security evidence response.');
  const result = body as Record<string, unknown>;
  if (!response.ok || result.success !== true) throw new Error(typeof result.error === 'string' ? result.error : 'Security evidence request failed.');
  return result;
}

function readState(value: unknown): PolicyEvidenceState {
  if (!value || typeof value !== 'object') throw new Error('Security evidence state is missing.');
  const state = value as Record<string, unknown>;
  const date = (item: unknown) => item === null || (typeof item === 'string' && Number.isFinite(Date.parse(item)));
  if (!Array.isArray(state.policies) || state.policies.length !== SECURITY_POLICIES.length
    || !state.policies.every(item => item && typeof item === 'object'
      && SECURITY_POLICIES.some(policy => policy.id === item.id) && /^[a-f0-9]{64}$/.test(item.hash)
      && date(item.adoptedAt) && date(item.reviewedAt) && date(item.nextReviewAt))
    || new Set(state.policies.map(item => item.id)).size !== SECURITY_POLICIES.length
    || !date(state.lastLogReviewAt) || !date(state.nextLogReviewAt)
    || !Array.isArray(state.history) || state.history.length > 100
    || !state.history.every(item => item && typeof item === 'object' && Number.isSafeInteger(item.id)
      && item.id > 0 && typeof item.policyId === 'string' && ['log_review', 'adoption', 'policy_review'].includes(item.kind)
      && typeof item.summary === 'string' && typeof item.evidenceReference === 'string'
      && typeof item.recordedAt === 'string' && date(item.recordedAt) && Number.isSafeInteger(item.actorUserId))) {
    throw new Error('Security evidence state could not be verified.');
  }
  return value as PolicyEvidenceState;
}

export default function SecurityPolicyEvidenceView({ revision, blocked, onHelp, onState }: {
  revision: number | null; blocked: boolean; onHelp: () => void; onState: (state: PolicyEvidenceState) => void;
}) {
  const [state, setState] = useState<PolicyEvidenceState | null>(null);
  const [policyId, setPolicyId] = useState('logging-monitoring');
  const [kind, setKind] = useState<PolicyEvidenceKind>('log_review');
  const [summary, setSummary] = useState('');
  const [reference, setReference] = useState('');
  const [from, setFrom] = useState(() => new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10));
  const [through, setThrough] = useState(() => new Date().toISOString().slice(0, 10));
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef<AbortController | null>(null);
  const operation = useRef<string | null>(null);
  const stateCallback = useRef(onState);
  stateCallback.current = onState;

  async function load() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setError('');
    try {
      const next = readState((await responseBody(await fetch('/api/admin/security-compliance/evidence', {
        cache: 'no-store', signal: controller.signal,
      }))).state);
      if (!controller.signal.aborted) { setState(next); stateCallback.current(next); }
    } catch (caught) {
      if (!controller.signal.aborted) { setState(null); setError(caught instanceof Error ? caught.message : 'Security evidence could not be loaded.'); }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  useEffect(() => { void load(); return () => pending.current?.abort(); }, []);
  useEffect(() => { operation.current = null; setAcknowledged(false); setNotice(''); }, [policyId, kind, summary, reference, from, through, revision]);

  async function save() {
    const selected = state?.policies.find(policy => policy.id === policyId);
    if (!selected || revision === null || blocked || !acknowledged || busy) return;
    setBusy(true); setError(''); setNotice('');
    operation.current ??= crypto.randomUUID();
    try {
      const body = await responseBody(await fetch('/api/admin/security-compliance/evidence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policyId, kind, expectedRevision: revision, policyHash: selected.hash, operationKey: operation.current,
          summary, evidenceReference: reference, reviewFrom: kind === 'log_review' ? from : null,
          reviewThrough: kind === 'log_review' ? through : null, acknowledged: true,
        }),
      }));
      if (!body.record || typeof body.record !== 'object' || !('id' in body.record)
        || typeof body.record.id !== 'number' || !Number.isSafeInteger(body.record.id)) throw new Error('Saved security evidence could not be verified.');
      setAcknowledged(false); operation.current = null;
      setNotice('Evidence recorded. This is an attributed attestation, not certification that every technical control operates.');
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Security evidence could not be saved.'); }
    finally { setBusy(false); }
  }

  const current = state?.policies.find(policy => policy.id === policyId);
  const format = (value: string | null | undefined) => value ? new Date(value).toLocaleString('en-AU') : 'Not recorded';
  const overdue = state?.nextLogReviewAt && Date.parse(state.nextLogReviewAt) <= Date.now();
  return <section className={styles.card} aria-labelledby="security-evidence-title">
    <div className={styles.heading}>
      <h2 id="security-evidence-title">Security reviews and policy adoption</h2>
      <button type="button" aria-label="Security evidence help" onClick={onHelp}>Help</button>
    </div>
    <p>Platform-wide evidence, not an Amazon-only register. No adoption or review is recorded automatically.</p>
    <p>Security log review: {format(state?.lastLogReviewAt)}. Next review: {format(state?.nextLogReviewAt)}.</p>
    {state && (!state.lastLogReviewAt || overdue) && <p className={styles.warning}>{overdue ? 'Security log review overdue.' : 'No security log review has been recorded. Complete the initial review.'} Reviews are required at least every 14 days. No automatic reminder email is configured.</p>}
    <p>Review the authentication history in Team Access and Security and the relevant hosting, source-control and other security logs. Existing authentication entries are retained for 12 months; older deleted history cannot be recovered by this change.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    <fieldset className={styles.roles} disabled={busy || blocked || revision === null || !state}>
      <legend className={styles.srOnly}>Record security evidence</legend>
      <label className={styles.role}>Evidence type
        <select value={kind} onChange={event => {
          const value = event.target.value;
          if (value === 'log_review' || value === 'adoption' || value === 'policy_review') {
            setKind(value); if (value === 'log_review') setPolicyId('logging-monitoring');
          }
        }}>
          <option value="log_review">Security log review</option><option value="adoption">Adopt policy</option><option value="policy_review">Periodic policy review</option>
        </select>
      </label>
      <label className={styles.role}>Policy
        <select value={policyId} disabled={kind === 'log_review'} onChange={event => setPolicyId(event.target.value)}>
          {SECURITY_POLICIES.map(policy => <option key={policy.id} value={policy.id}>{policy.title}</option>)}
        </select>
      </label>
      {kind === 'log_review' && <>
        <label className={styles.role}>Reviewed from (UTC date)<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
        <label className={styles.role}>Reviewed through (UTC date)<input type="date" value={through} max={new Date().toISOString().slice(0, 10)} onChange={event => setThrough(event.target.value)} /></label>
      </>}
      <label className={styles.role}>Review/adoption summary<input value={summary} maxLength={1000} onChange={event => setSummary(event.target.value)} /></label>
      <label className={styles.role}>Safe evidence reference<input value={reference} maxLength={500} onChange={event => setReference(event.target.value)} /></label>
    </fieldset>
    <p>Current selected policy: {current?.adoptedAt ? `Adopted ${format(current.adoptedAt)}` : 'Draft - not yet adopted'}. Next periodic policy review: {format(current?.nextReviewAt)}. Incident response is reviewed every six months; other policy documents annually. Operational reviews listed in the detailed policy remain separate requirements.</p>
    <p>Include the findings, follow-up owner/actions and where the restricted evidence is held. Never enter credentials, tokens, customer information or raw log payloads here.</p>
    <label className={styles.acknowledgement}><input type="checkbox" checked={acknowledged}
      disabled={busy || blocked || !state || revision === null} onChange={event => setAcknowledged(event.target.checked)} />
      I have actually completed this review or authorized this policy adoption, and the referenced evidence supports the entry.
    </label>
    <div className={styles.actions}>
      <button type="button" disabled={busy || blocked || !state || revision === null || !acknowledged || !summary.trim() || !reference.trim()
        || (kind === 'policy_review' && !current?.adoptedAt)} onClick={() => void save()}>Record evidence</button>
      <button type="button" disabled={busy} onClick={() => void load()}>Reload evidence</button>
    </div>
    {blocked && <p>Save or reload responsibility changes before recording evidence.</p>}
    <h3>Latest 100 evidence entries</h3>
    <ul className={styles.inventoryList}>{state?.history.map(entry => <li key={entry.id}>
      <strong>{entry.kind.replaceAll('_', ' ')}: {SECURITY_POLICIES.find(policy => policy.id === entry.policyId)?.title ?? entry.policyId}</strong>
      <p>{format(entry.recordedAt)} - approver account {entry.actorUserId}, responsibility revision {entry.assignmentRevision}, policy version {entry.policyVersion}.</p>
      {entry.reviewFrom && <p>Reviewed UTC period: {entry.reviewFrom} to {entry.reviewThrough}.</p>}
      <p>{entry.summary}</p><p>Evidence reference: {entry.evidenceReference}</p>
    </li>)}</ul>
  </section>;
}
