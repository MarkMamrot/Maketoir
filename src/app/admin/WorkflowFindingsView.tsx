'use client';

import { useCallback, useEffect, useState } from 'react';

type FindingStatus = 'new' | 'triaging' | 'confirmed_defect' | 'confirmed_gap' | 'intentional_design' | 'planned' | 'duplicate' | 'declined' | 'resolved';

interface WorkflowFinding {
  id: number;
  category: string;
  impact: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  status: FindingStatus;
  capability: string;
  title: string;
  audiences_json: unknown;
  evidence_json?: unknown;
  first_seen_at: string;
  last_seen_at: string;
  occurrence_count: number;
  affected_business_count: number;
  escalation_count: number;
  open_escalation_count: number;
  next_response_due_at: string | null;
  assigned_to: number | null;
  assigned_name: string | null;
  resolution_notes?: string | null;
}

interface FindingEvent {
  id: number;
  event_type: string;
  message: string | null;
  evidence_json: unknown;
  actor_name: string | null;
  created_at: string;
}

interface EscalationCase {
  id: number;
  public_reference: string;
  business_name: string;
  audience: string;
  actor_type: string;
  can_follow_up_directly: number;
  current_view: string | null;
  status: string;
  response_due_at: string;
  assigned_name: string | null;
  created_at: string;
}

const panel = { background: 'var(--sv-bg-1,#1e293b)', border: '1px solid var(--sv-etch,rgba(255,255,255,.1))', borderRadius: 8 };
const input = { padding: '8px 10px', background: 'var(--sv-bg-2,#334155)', border: '1px solid var(--sv-etch,rgba(255,255,255,.15))', borderRadius: 6, color: 'var(--sv-text-main,#e2e8f0)', fontSize: 12 };
const ACTIVE_STATUSES: FindingStatus[] = ['new', 'triaging', 'confirmed_defect', 'confirmed_gap', 'planned'];
const DECISIONS: Array<{ status: FindingStatus; label: string; color?: string }> = [
  { status: 'new', label: 'New' }, { status: 'triaging', label: 'Triaging', color: '#1d4ed8' },
  { status: 'confirmed_defect', label: 'Defect', color: '#be123c' }, { status: 'confirmed_gap', label: 'Gap', color: '#b45309' },
  { status: 'intentional_design', label: 'Intentional', color: '#475569' }, { status: 'planned', label: 'Planned', color: '#6d28d9' },
  { status: 'duplicate', label: 'Duplicate' }, { status: 'declined', label: 'Declined' }, { status: 'resolved', label: 'Resolved', color: '#047857' },
];

function dateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function formatJson(value: unknown): string | null {
  if (value == null || value === '') return null;
  try { return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2); } catch { return String(value); }
}

function impactColor(impact: WorkflowFinding['impact']) {
  return impact === 'critical' ? '#fb7185' : impact === 'high' ? '#f59e0b' : impact === 'medium' ? '#38bdf8' : '#94a3b8';
}

async function responseJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export default function WorkflowFindingsView() {
  const [findings, setFindings] = useState<WorkflowFinding[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [status, setStatus] = useState<FindingStatus | ''>('new');
  const [impact, setImpact] = useState('');
  const [capability, setCapability] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ finding: WorkflowFinding; events: FindingEvent[]; cases: EscalationCase[] } | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams({ limit: '200' });
    if (status) params.set('status', status);
    if (impact) params.set('impact', impact);
    if (capability) params.set('capability', capability);
    if (search.trim()) params.set('search', search.trim());
    try {
      const response = await fetch(`/api/admin/workflow-findings?${params}`);
      const data = await responseJson(response);
      if (!response.ok || !data) throw new Error(data?.error || 'Workflow findings could not be loaded.');
      setFindings(data.findings ?? []);
      setSummary(Object.fromEntries((data.summary ?? []).map((row: any) => [row.status, Number(row.count)])));
      setCapabilities((data.capabilities ?? []).map((row: any) => row.capability));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Workflow findings could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [capability, impact, search, status]);

  useEffect(() => { void load(); }, [load]);

  const openFinding = async (id: number) => {
    const response = await fetch(`/api/admin/workflow-findings/${id}`);
    const data = await responseJson(response);
    if (response.ok && data) {
      setSelected({ finding: data.finding, events: data.events ?? [], cases: data.cases ?? [] });
      setNotes(data.finding.resolution_notes ?? '');
    }
  };

  const updateStatus = async (nextStatus: FindingStatus) => {
    if (!selected) return;
    setSaving(true);
    const response = await fetch(`/api/admin/workflow-findings/${selected.finding.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus, assignedTo: selected.finding.assigned_to, resolutionNotes: notes }),
    });
    setSaving(false);
    if (response.ok) { setSelected(null); await load(); }
  };

  const activeCount = ACTIVE_STATUSES.reduce((total, item) => total + (summary[item] ?? 0), 0);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Workflow Findings</h1>
          <p style={{ margin: '5px 0 0', color: '#94a3b8', fontSize: 12 }}>Evidence-backed candidates awaiting human product review.</p>
        </div>
        <div style={{ color: '#94a3b8', fontSize: 12 }}>{activeCount} active</div>
      </div>

      <div style={{ ...panel, padding: 12, display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 180px 160px 170px auto', gap: 8, marginBottom: 12 }}>
        <input aria-label="Search findings" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search title, capability, category" style={input} />
        <select aria-label="Status" value={status} onChange={event => setStatus(event.target.value as FindingStatus | '')} style={input}>
          <option value="">All statuses</option>
          {DECISIONS.map(item => <option key={item.status} value={item.status}>{item.label} ({summary[item.status] ?? 0})</option>)}
        </select>
        <select aria-label="Impact" value={impact} onChange={event => setImpact(event.target.value)} style={input}>
          <option value="">All impacts</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <select aria-label="Capability" value={capability} onChange={event => setCapability(event.target.value)} style={input}>
          <option value="">All capabilities</option>
          {capabilities.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        <button onClick={() => void load()} style={{ ...input, cursor: 'pointer', fontWeight: 700 }}>Refresh</button>
      </div>

      <div style={{ ...panel, overflowX: 'auto' }}>
        <div style={{ minWidth: 900 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '90px 150px minmax(260px,2fr) 100px 110px 150px', padding: '9px 12px', background: '#334155', color: '#94a3b8', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
            <span>Impact</span><span>Capability</span><span>Finding</span><span>Reach</span><span>Cases</span><span>Last seen</span>
          </div>
          {loading ? <p style={{ padding: 24, color: '#94a3b8' }}>Loading...</p> : loadError ? <p style={{ padding: 24, color: '#fca5a5' }}>{loadError}</p> : findings.length === 0 ? <p style={{ padding: 24, color: '#94a3b8' }}>No matching workflow findings.</p> : findings.map(finding => (
            <button key={finding.id} onClick={() => void openFinding(finding.id)} style={{ width: '100%', display: 'grid', gridTemplateColumns: '90px 150px minmax(260px,2fr) 100px 110px 150px', alignItems: 'center', padding: '11px 12px', border: 0, borderTop: '1px solid rgba(255,255,255,.07)', background: 'transparent', color: '#e2e8f0', textAlign: 'left', cursor: 'pointer', fontSize: 12 }}>
              <span style={{ color: impactColor(finding.impact), fontWeight: 800, textTransform: 'uppercase', fontSize: 10 }}>{finding.impact}</span>
              <span><strong>{finding.capability}</strong><br /><small style={{ color: '#94a3b8' }}>{finding.category.replaceAll('_', ' ')}</small></span>
              <span><strong>{finding.title}</strong><br /><small style={{ color: '#94a3b8' }}>{finding.status.replaceAll('_', ' ')}</small></span>
              <span>{finding.occurrence_count} / {finding.affected_business_count}</span>
              <span>{finding.open_escalation_count} open<br /><small style={{ color: '#94a3b8' }}>{finding.next_response_due_at ? `due ${dateTime(finding.next_response_due_at)}` : 'none due'}</small></span>
              <span>{dateTime(finding.last_seen_at)}</span>
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,.82)', display: 'flex', justifyContent: 'flex-end' }} onClick={() => setSelected(null)}>
          <div style={{ width: 'min(760px,100vw)', height: '100%', overflow: 'auto', background: '#0f172a', borderLeft: '1px solid rgba(255,255,255,.12)', padding: 24 }} onClick={event => event.stopPropagation()}>
            <button aria-label="Close finding" onClick={() => setSelected(null)} style={{ float: 'right', ...input, cursor: 'pointer' }}>x</button>
            <p style={{ color: impactColor(selected.finding.impact), textTransform: 'uppercase', fontSize: 10, fontWeight: 800 }}>{selected.finding.impact} · {selected.finding.category.replaceAll('_', ' ')}</p>
            <h2 style={{ margin: '6px 0' }}>{selected.finding.title}</h2>
            <p style={{ color: '#94a3b8', fontSize: 12 }}>{selected.finding.capability} · {selected.finding.occurrence_count} observations across {selected.finding.affected_business_count} organisations</p>
            {formatJson(selected.finding.evidence_json) && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#cbd5e1', fontSize: 10, background: '#020617', padding: 12, borderRadius: 5 }}>{formatJson(selected.finding.evidence_json)}</pre>}

            <h3 style={{ fontSize: 14, marginTop: 22 }}>Linked user cases</h3>
            {selected.cases.length === 0 ? <p style={{ color: '#94a3b8', fontSize: 12 }}>No linked cases.</p> : selected.cases.map(item => (
              <div key={item.id} style={{ ...panel, padding: 11, marginBottom: 7, display: 'grid', gridTemplateColumns: '130px 1fr auto', gap: 10, fontSize: 12 }}>
                <strong>{item.public_reference}</strong>
                <span>{item.business_name}<br /><small style={{ color: '#94a3b8' }}>{item.audience} · {item.status} · {item.can_follow_up_directly ? 'direct follow-up' : 'in-app follow-up'}</small></span>
                <span style={{ color: new Date(item.response_due_at) < new Date() ? '#fb7185' : '#cbd5e1' }}>Due {dateTime(item.response_due_at)}</span>
              </div>
            ))}

            <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, margin: '20px 0 6px' }}>Review notes</label>
            <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={4} style={{ ...input, width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, margin: '10px 0 24px' }}>
              {DECISIONS.map(item => <button key={item.status} disabled={saving} onClick={() => void updateStatus(item.status)} style={{ ...input, cursor: saving ? 'wait' : 'pointer', background: item.color ?? input.background, fontWeight: 700 }}>{item.label}</button>)}
            </div>

            <h3 style={{ fontSize: 14 }}>Review history</h3>
            {selected.events.map(event => <div key={event.id} style={{ ...panel, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 10 }}><strong>{event.event_type.replaceAll('_', ' ')}</strong><span>{dateTime(event.created_at)}</span></div>
              {event.message && <p style={{ margin: '7px 0', fontSize: 12 }}>{event.message}</p>}
              {formatJson(event.evidence_json) && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#cbd5e1', fontSize: 10, background: '#020617', padding: 10, borderRadius: 5 }}>{formatJson(event.evidence_json)}</pre>}
            </div>)}
          </div>
        </div>
      )}
    </div>
  );
}