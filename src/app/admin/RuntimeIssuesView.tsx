'use client';

import { useCallback, useEffect, useState } from 'react';

interface RuntimeIssue {
  id: number;
  business_id: string | null;
  business_name: string;
  source: string;
  operation: string;
  severity: 'warning' | 'error' | 'critical';
  status: 'new' | 'in_progress' | 'fixed';
  title: string;
  message: string;
  first_seen_at: string;
  last_seen_at: string;
  occurrence_count: number;
  source_reference_type: string | null;
  source_reference_id: string | null;
  assigned_to: number | null;
  assigned_name: string | null;
}

interface IssueDetail extends RuntimeIssue {
  latest_context: unknown;
  resolution_notes: string | null;
}

interface IssueEvent {
  id: number;
  event_type: string;
  severity: string | null;
  message: string | null;
  stack_trace: string | null;
  context: unknown;
  actor_name: string | null;
  created_at: string;
}

const panel = { background: 'var(--sv-bg-1,#1e293b)', border: '1px solid var(--sv-etch,rgba(255,255,255,.1))', borderRadius: 8 };
const input = { padding: '8px 10px', background: 'var(--sv-bg-2,#334155)', border: '1px solid var(--sv-etch,rgba(255,255,255,.15))', borderRadius: 6, color: 'var(--sv-text-main,#e2e8f0)', fontSize: 12 };
const drawerSurface = '#0f172a';
const drawerPanel = { background: '#172033', border: '1px solid #334155', borderRadius: 8 };
const drawerInput = { padding: '9px 11px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 6, color: '#0f172a', fontSize: 12 };

function dateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function severityColor(severity: RuntimeIssue['severity']) {
  return severity === 'critical' ? '#fb7185' : severity === 'error' ? '#f59e0b' : '#38bdf8';
}

function formatContext(value: unknown): string | null {
  if (value == null || value === '') return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(value);
  }
}

async function responseJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export default function RuntimeIssuesView() {
  const [issues, setIssues] = useState<RuntimeIssue[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [businesses, setBusinesses] = useState<Array<{ business_id: string; name: string }>>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [status, setStatus] = useState('new');
  const [severity, setSeverity] = useState('');
  const [source, setSource] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ issue: IssueDetail; events: IssueEvent[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams({ limit: '200' });
    if (status) params.set('status', status);
    if (severity) params.set('severity', severity);
    if (source) params.set('source', source);
    if (businessId) params.set('businessId', businessId);
    if (search.trim()) params.set('search', search.trim());
    try {
      const response = await fetch(`/api/admin/runtime-issues?${params}`);
      const data = await responseJson(response);
      if (!response.ok || !data) {
        setLoadError(data?.error ?? 'Runtime issues could not be loaded.');
        return;
      }
      setIssues(data.issues ?? []);
      setSummary(Object.fromEntries((data.summary ?? []).map((row: any) => [row.status, Number(row.count)])));
      setBusinesses(data.businesses ?? []);
      setSources((data.sources ?? []).map((row: any) => row.source));
    } catch {
      setLoadError('Runtime issues could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [businessId, search, severity, source, status]);

  useEffect(() => { void load(); }, [load]);

  const openIssue = async (id: number) => {
    const response = await fetch(`/api/admin/runtime-issues/${id}`);
    const data = await responseJson(response);
    if (response.ok && data) {
      setSelected({ issue: data.issue, events: data.events ?? [] });
      setNotes(data.issue.resolution_notes ?? '');
    }
  };

  const updateStatus = async (nextStatus: RuntimeIssue['status']) => {
    if (!selected) return;
    setSaving(true);
    const response = await fetch(`/api/admin/runtime-issues/${selected.issue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus, assignedTo: selected.issue.assigned_to, resolutionNotes: notes }),
    });
    setSaving(false);
    if (response.ok) {
      setSelected(null);
      await load();
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Runtime Issues</h1>
          <p style={{ margin: '5px 0 0', color: '#94a3b8', fontSize: 12 }}>Cross-organisation integration failures and application exceptions.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['new', 'in_progress', 'fixed'] as const).map(item => (
            <button key={item} onClick={() => setStatus(item)} style={{ ...panel, padding: '8px 12px', cursor: 'pointer', color: status === item ? '#fff' : '#94a3b8', background: status === item ? '#2563eb' : panel.background, fontSize: 12, fontWeight: 700 }}>
              {item === 'in_progress' ? 'In progress' : item[0].toUpperCase() + item.slice(1)} · {summary[item] ?? 0}
            </button>
          ))}
          <button onClick={() => setStatus('')} style={{ ...panel, padding: '8px 12px', cursor: 'pointer', color: status === '' ? '#fff' : '#94a3b8', background: status === '' ? '#2563eb' : panel.background, fontSize: 12 }}>All</button>
        </div>
      </div>

      <div style={{ ...panel, padding: 12, display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 180px 160px 160px auto', gap: 8, marginBottom: 12 }}>
        <input aria-label="Search issues" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search title, message, operation" style={input} />
        <select aria-label="Organisation" value={businessId} onChange={event => setBusinessId(event.target.value)} style={input}>
          <option value="">All organisations</option>
          {businesses.map(business => <option key={business.business_id} value={business.business_id}>{business.name}</option>)}
        </select>
        <select aria-label="Source" value={source} onChange={event => setSource(event.target.value)} style={input}>
          <option value="">All sources</option>
          {sources.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        <select aria-label="Severity" value={severity} onChange={event => setSeverity(event.target.value)} style={input}>
          <option value="">All severities</option>
          <option value="critical">Critical</option><option value="error">Error</option><option value="warning">Warning</option>
        </select>
        <button onClick={() => void load()} style={{ ...input, cursor: 'pointer', fontWeight: 700 }}>Refresh</button>
      </div>

      <div style={{ ...panel, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(140px,1fr) 150px minmax(240px,2fr) 90px 150px', padding: '9px 12px', background: '#334155', color: '#94a3b8', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
          <span>Severity</span><span>Organisation</span><span>Source</span><span>Issue</span><span>Count</span><span>Last seen</span>
        </div>
        {loading ? <p style={{ padding: 24, color: '#94a3b8' }}>Loading…</p> : loadError ? <p style={{ padding: 24, color: '#fca5a5' }}>{loadError}</p> : issues.length === 0 ? <p style={{ padding: 24, color: '#94a3b8' }}>No matching runtime issues.</p> : issues.map(issue => (
          <button key={issue.id} onClick={() => void openIssue(issue.id)} style={{ width: '100%', display: 'grid', gridTemplateColumns: '110px minmax(140px,1fr) 150px minmax(240px,2fr) 90px 150px', alignItems: 'center', padding: '11px 12px', border: 0, borderTop: '1px solid rgba(255,255,255,.07)', background: 'transparent', color: '#e2e8f0', textAlign: 'left', cursor: 'pointer', fontSize: 12 }}>
            <span style={{ color: severityColor(issue.severity), fontWeight: 800, textTransform: 'uppercase', fontSize: 10 }}>{issue.severity}</span>
            <span>{issue.business_name}</span>
            <span><strong>{issue.source}</strong><br /><small style={{ color: '#94a3b8' }}>{issue.operation}</small></span>
            <span><strong>{issue.title}</strong><br /><small style={{ color: '#94a3b8' }}>{issue.message}</small></span>
            <span>{issue.occurrence_count}</span>
            <span>{dateTime(issue.last_seen_at)}</span>
          </button>
        ))}
      </div>

      {selected && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,.72)', display: 'flex', justifyContent: 'flex-end' }} onClick={() => setSelected(null)}>
          <aside aria-label="Runtime issue details" style={{ width: 'min(680px, 100vw)', height: '100dvh', overflowY: 'auto', boxSizing: 'border-box', background: drawerSurface, borderLeft: '1px solid #334155', color: '#e2e8f0', boxShadow: '-20px 0 50px rgba(2,6,23,.28)' }} onClick={event => event.stopPropagation()}>
            <div style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '14px 20px', background: 'rgba(15,23,42,.97)', borderBottom: '1px solid #334155' }}>
              <p style={{ margin: 0, color: severityColor(selected.issue.severity), textTransform: 'uppercase', fontSize: 10, fontWeight: 800 }}>{selected.issue.severity} · {selected.issue.source} / {selected.issue.operation}</p>
              <button aria-label="Close issue" title="Close" onClick={() => setSelected(null)} style={{ width: 34, height: 34, border: '1px solid #475569', borderRadius: 6, background: '#1e293b', color: '#f8fafc', cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: '20px clamp(16px, 4vw, 28px) 32px' }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, lineHeight: 1.3 }}>{selected.issue.title}</h2>
            <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.55, fontSize: 13 }}>{selected.issue.message}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, ...drawerPanel, padding: 14, margin: '18px 0' }}>
              <span><small style={{ color: '#94a3b8' }}>Organisation</small><br />{selected.issue.business_name}</span>
              <span><small style={{ color: '#94a3b8' }}>Occurrences</small><br />{selected.issue.occurrence_count}</span>
              <span><small style={{ color: '#94a3b8' }}>First seen</small><br />{dateTime(selected.issue.first_seen_at)}</span>
              <span><small style={{ color: '#94a3b8' }}>Last seen</small><br />{dateTime(selected.issue.last_seen_at)}</span>
            </div>
            {formatContext(selected.issue.latest_context) && (
              <>
                <h3 style={{ fontSize: 14 }}>Latest context</h3>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#cbd5e1', fontSize: 10, background: '#020617', padding: 10, borderRadius: 5 }}>{formatContext(selected.issue.latest_context)}</pre>
              </>
            )}
            <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, marginBottom: 6 }}>Resolution notes</label>
            <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={4} style={{ ...drawerInput, width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 104 }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '10px 0 22px' }}>
              <button disabled={saving} onClick={() => void updateStatus('new')} style={{ ...drawerInput, cursor: 'pointer', background: '#f8fafc', color: '#334155', fontWeight: 700 }}>Mark new</button>
              <button disabled={saving} onClick={() => void updateStatus('in_progress')} style={{ ...drawerInput, cursor: 'pointer', borderColor: '#60a5fa', background: '#1d4ed8', color: '#fff', fontWeight: 700 }}>In progress</button>
              <button disabled={saving} onClick={() => void updateStatus('fixed')} style={{ ...drawerInput, cursor: 'pointer', borderColor: '#34d399', background: '#047857', color: '#fff', fontWeight: 700 }}>Mark fixed</button>
            </div>
            <h3 style={{ fontSize: 14 }}>Occurrence history</h3>
            {selected.events.map(event => (
              <div key={event.id} style={{ ...drawerPanel, padding: 12, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: '#94a3b8', fontSize: 10 }}><strong>{event.event_type}</strong><span>{dateTime(event.created_at)}</span></div>
                {event.message && <p style={{ margin: '7px 0', fontSize: 12 }}>{event.message}</p>}
                {event.stack_trace && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#fca5a5', fontSize: 10, background: '#020617', padding: 10, borderRadius: 5 }}>{event.stack_trace}</pre>}
                {formatContext(event.context) && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#cbd5e1', fontSize: 10, background: '#020617', padding: 10, borderRadius: 5 }}>{formatContext(event.context)}</pre>}
              </div>
            ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
