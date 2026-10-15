'use client';

import { useEffect, useRef, useState } from 'react';
import { UnifiedHelpDrawer } from '@/components/help/UnifiedHelpDrawer';
import {
  createDefaultPolicyAssignments, POLICY_ROLES, SECURITY_POLICIES, validatePolicyAssignments,
  type PolicyAssignments, type PolicyAssignmentState,
} from '@/lib/securityCompliance/policies';
import styles from './SecurityComplianceView.module.css';
import AmazonPiiInventoryView from './AmazonPiiInventoryView';
import AmazonDeliveryEvidenceView from './AmazonDeliveryEvidenceView';

async function readState(response: Response): Promise<PolicyAssignmentState> {
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object') throw new Error('Invalid security policy response.');
  const result = body as Record<string, unknown>;
  if (!response.ok || result.success !== true) {
    throw new Error(typeof result.error === 'string' ? result.error : 'Security policy request failed.');
  }
  if (!result.state || typeof result.state !== 'object') throw new Error('Policy responsibility state is missing.');
  const state = result.state as Record<string, unknown>;
  if (typeof state.revision !== 'number' || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !(state.updatedAt === null || (typeof state.updatedAt === 'string' && Number.isFinite(Date.parse(state.updatedAt))))
    || !(state.updatedBy === null || (typeof state.updatedBy === 'number' && Number.isSafeInteger(state.updatedBy) && state.updatedBy > 0))) {
    throw new Error('Invalid policy responsibility state.');
  }
  return {
    assignments: validatePolicyAssignments(state.assignments), revision: state.revision,
    updatedAt: state.updatedAt, updatedBy: state.updatedBy,
  };
}

export default function SecurityComplianceView() {
  const [selectedId, setSelectedId] = useState(SECURITY_POLICIES[0].id);
  const [saved, setSaved] = useState<PolicyAssignmentState | null>(null);
  const [assignments, setAssignments] = useState<PolicyAssignments>(createDefaultPolicyAssignments);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpContext, setHelpContext] = useState('security-compliance');
  const loadRequest = useRef<AbortController | null>(null);

  async function load() {
    loadRequest.current?.abort();
    const controller = new AbortController();
    loadRequest.current = controller;
    setLoading(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/security-compliance', { cache: 'no-store', signal: controller.signal });
      const state = await readState(response);
      if (controller.signal.aborted) return;
      setSaved(state); setAssignments(state.assignments); setNeedsReload(false);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setNeedsReload(true);
      setError(caught instanceof Error ? caught.message : 'Responsibilities could not be loaded.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => loadRequest.current?.abort();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!saved || loading || saving || needsReload) return;
    let validated: PolicyAssignments;
    try { validated = validatePolicyAssignments(assignments); }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Check responsibility names.');
      return;
    }
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/security-compliance', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments: validated, expectedRevision: saved.revision }),
      });
      const state = await readState(response);
      setSaved(state); setAssignments(state.assignments);
      setNotice('Responsibilities saved. Policy adoption and technical enforcement are separate steps.');
    } catch (caught) {
      setNeedsReload(true);
      setError(`${caught instanceof Error ? caught.message : 'Responsibilities could not be saved.'} Reload saved values before another save.`);
    } finally { setSaving(false); }
  }

  const policy = SECURITY_POLICIES.find(item => item.id === selectedId) ?? SECURITY_POLICIES[0];
  const dirty = saved && POLICY_ROLES.some(role => assignments[role.id] !== saved.assignments[role.id]);

  return <section className={styles.workspace} aria-labelledby="security-compliance-title">
    <header className={styles.heading}>
      <div>
        <h1 id="security-compliance-title">Security &amp; Compliance</h1>
        <p>Internal policies for developers and platform administrators. Organization-wide, not business-specific.</p>
      </div>
      <button type="button" onClick={() => { setHelpContext('security-compliance'); setHelpOpen(true); }}>Help</button>
    </header>

    <div className={styles.warning}>
      <strong>Draft policies - controls are not certified</strong>
      <p>These documents define the practices to adopt. Saving responsible names does not approve a policy, grant access, configure reminders, or implement password expiry, KMS, audit retention, or PII deletion.</p>
    </div>

    <AmazonPiiInventoryView onHelp={() => { setHelpContext('amazon-pii-inventory'); setHelpOpen(true); }} />
    <AmazonDeliveryEvidenceView onHelp={() => { setHelpContext('amazon-delivery-evidence'); setHelpOpen(true); }} />

    <form className={styles.card} onSubmit={event => void save(event)}>
      <h2>Responsibilities</h2>
      <p>Enter names as text. Every role defaults to Marek Mamrot until saved otherwise. Changes apply across these policies and are recorded with the signed-in account and revision.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.success}>{notice}</p>}
      {loading && <p role="status">Loading saved responsibilities...</p>}
      <fieldset disabled={loading || saving || needsReload || !saved} className={styles.roles}>
        <legend className={styles.srOnly}>Policy responsibility names</legend>
        {POLICY_ROLES.map(role => <label key={role.id} className={styles.role}>
          <span id={`policy-role-${role.id}`}>{role.label}</span>
          <input type="text" value={assignments[role.id]} maxLength={120} required
            aria-labelledby={`policy-role-${role.id}`} aria-describedby={`policy-description-${role.id}`}
            onChange={event => {
              setAssignments(current => ({ ...current, [role.id]: event.target.value }));
              setNotice('');
            }} />
          <small id={`policy-description-${role.id}`}>{role.description}</small>
        </label>)}
      </fieldset>
      <div className={styles.warning}>
        <p>Assign a distinct reviewer before relying on independent change approval. The default names also do not establish an available incident backup.</p>
      </div>
      <div className={styles.actions}>
        <button type="submit" disabled={loading || saving || needsReload || !saved || (!dirty && saved.revision > 0)}>
          {saving ? 'Saving...' : 'Save responsibilities'}
        </button>
        <button type="button" disabled={loading || saving} onClick={() => void load()}>Reload saved values</button>
        <span>{saved ? saved.revision === 0
          ? 'Default values - not yet saved'
          : `Saved revision ${saved.revision}${saved.updatedAt ? ` on ${new Date(saved.updatedAt).toLocaleString('en-AU')}` : ''}`
          : 'Saved values unavailable'}{dirty ? ' - unsaved changes' : ''}</span>
      </div>
      {dirty && <p>Reloading saved values discards unsaved edits.</p>}
    </form>

    <nav aria-label="Security policies" className={styles.policyNav}>
      {SECURITY_POLICIES.map(item => <button key={item.id} type="button" aria-pressed={policy.id === item.id}
        onClick={() => setSelectedId(item.id)}>{item.title}</button>)}
    </nav>

    <article className={styles.card} aria-labelledby="selected-policy-title">
      <h2 id="selected-policy-title">{policy.title}</h2>
      <p>Version {policy.version} | Draft - not yet adopted | Review: {policy.reviewCadence}</p>
      <h3>Quick summary</h3>
      <ul>{policy.summary.map(item => <li key={item}>{item}</li>)}</ul>
      <h3>Responsible people</h3>
      <dl className={styles.assignedRoles}>
        {policy.roles.map(id => <div key={id}>
          <dt>{POLICY_ROLES.find(role => role.id === id)?.label}</dt>
          <dd>{saved && !needsReload ? saved.assignments[id] : 'Saved assignment unavailable'}</dd>
        </div>)}
      </dl>
      <h3>Detailed policy</h3>
      {policy.sections.map(section => <section key={section.heading} className={styles.policySection}>
        <h4>{section.heading}</h4>
        {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      </section>)}
    </article>

    <UnifiedHelpDrawer open={helpOpen} onOpenChange={setHelpOpen} audience="ims" product="setup"
      currentContext={helpContext} userTier="SuperAdmin" showFloatingTrigger={false}
      assistantDisabled assistantDisabledLabel="Use Help for this internal policy workspace."
      chatEndpoint="/api/ims/assistant/chat" escalationEndpoint="/api/ims/assistant/escalate" />
  </section>;
}
