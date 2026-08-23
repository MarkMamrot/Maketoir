'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Save, X } from 'lucide-react';

const statuses = ['new', 'contacting', 'qualified', 'demo_booked', 'won', 'lost', 'spam'];
const panel: React.CSSProperties = { background: '#172033', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: 14 };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#243147', border: '1px solid rgba(255,255,255,.14)', color: '#e2e8f0', borderRadius: 6, padding: '8px 9px', fontSize: 12 };
const button: React.CSSProperties = { border: 0, borderRadius: 6, padding: '7px 10px', background: '#1687a2', color: '#fff', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 };
interface Capabilities { assignment: boolean; notes: boolean; lossReason: boolean }
interface Lead { id: number; name: string; company?: string; email?: string; phone?: string; preferred_contact: string; current_systems?: string; source_path?: string; status: string; created_at: string; last_user_prompt?: string }

export default function ProspectLeadsView() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities>({ assignment: false, notes: false, lossReason: false });
  const [filters, setFilters] = useState({ search: '', status: '', integration: '', source: '', from: '', to: '' });
  const [selected, setSelected] = useState<any>(null);
  const [edit, setEdit] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    try {
      const response = await fetch(`/api/admin/prospect-leads?${params}`); const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load leads.');
      setLeads(data.leads || []); setCapabilities(data.capabilities);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Failed to load leads.'); }
    finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { void load(); }, [load]);

  const open = async (id: number) => {
    const response = await fetch(`/api/admin/prospect-leads/${id}`); const data = await response.json();
    if (!response.ok) { setError(data.error || 'Lead could not be loaded.'); return; }
    setSelected(data); setCapabilities(data.capabilities); setEdit({ status: data.lead.status, assignedTo: data.lead.assigned_to, notes: data.lead.notes || '', lossReason: data.lead.loss_reason || '' });
  };
  const save = async () => {
    if (!selected) return;
    const payload: any = { status: edit.status };
    if (capabilities.assignment) payload.assignedTo = edit.assignedTo || null;
    if (capabilities.notes) payload.notes = edit.notes;
    if (capabilities.lossReason) payload.lossReason = edit.lossReason;
    const response = await fetch(`/api/admin/prospect-leads/${selected.lead.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json(); if (!response.ok) { setError(data.error || 'Lead could not be saved.'); return; }
    setSelected(null); await load();
  };
  const updateFilter = (key: keyof typeof filters, value: string) => setFilters(current => ({ ...current, [key]: value }));

  return <div style={{ maxWidth: 1500, margin: '0 auto' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}><div style={{ flex: 1 }}><h1 style={{ margin: 0, fontSize: 22 }}>Prospect Leads</h1><p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 13 }}>Consent-backed sales leads and their assistant conversations.</p></div><button onClick={() => void load()} style={{ ...button, background: '#334155' }}><RefreshCw size={15} /> Refresh</button></div>
    <div style={{ ...panel, display: 'grid', gridTemplateColumns: 'minmax(220px,2fr) repeat(5,minmax(130px,1fr))', gap: 8, marginBottom: 12 }}>
      <input placeholder="Search name, company, email, phone" value={filters.search} onChange={e => updateFilter('search', e.target.value)} style={input} />
      <select value={filters.status} onChange={e => updateFilter('status', e.target.value)} style={input}><option value="">All statuses</option>{statuses.map(value => <option key={value}>{value}</option>)}</select>
      <input placeholder="Integration" value={filters.integration} onChange={e => updateFilter('integration', e.target.value)} style={input} />
      <input placeholder="Source path" value={filters.source} onChange={e => updateFilter('source', e.target.value)} style={input} />
      <input type="date" aria-label="Created from" value={filters.from} onChange={e => updateFilter('from', e.target.value)} style={input} />
      <input type="date" aria-label="Created to" value={filters.to} onChange={e => updateFilter('to', e.target.value)} style={input} />
    </div>
    {error && <p style={{ color: '#fca5a5', fontSize: 13 }}>{error}</p>}
    <div style={{ ...panel, padding: 0, overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 1000, borderCollapse: 'collapse' }}><thead><tr>{['Lead', 'Contact', 'Status', 'Systems', 'Source', 'Last prompt', 'Created'].map(label => <th key={label} style={{ textAlign: 'left', padding: '9px 12px', fontSize: 11, color: '#94a3b8', background: '#243147' }}>{label}</th>)}</tr></thead><tbody>
      {leads.map(lead => <tr key={lead.id} onClick={() => void open(lead.id)} style={{ borderTop: '1px solid rgba(255,255,255,.07)', cursor: 'pointer' }}><td style={{ padding: 12, fontSize: 13, fontWeight: 700 }}>{lead.name}<div style={{ color: '#94a3b8', fontSize: 11 }}>{lead.company || 'No company'}</div></td><td style={{ padding: 12, fontSize: 12 }}>{lead.email || lead.phone || lead.preferred_contact}</td><td style={{ padding: 12, fontSize: 12 }}>{lead.status}</td><td style={{ padding: 12, fontSize: 12 }}>{lead.current_systems || 'None supplied'}</td><td style={{ padding: 12, fontSize: 12 }}>{lead.source_path || 'Unknown'}</td><td style={{ padding: 12, fontSize: 12, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.last_user_prompt || ''}</td><td style={{ padding: 12, color: '#94a3b8', fontSize: 12 }}>{new Date(lead.created_at).toLocaleString()}</td></tr>)}
    </tbody></table>{loading && <p style={{ padding: 16, color: '#94a3b8' }}>Loading leads...</p>}{!loading && !leads.length && <p style={{ padding: 16, color: '#94a3b8' }}>No leads match these filters.</p>}</div>
    {selected && <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,.82)', padding: 18, display: 'grid', placeItems: 'center' }}><div style={{ ...panel, width: 'min(1100px,100%)', maxHeight: '92vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ flex: 1 }}><h2 style={{ margin: 0, fontSize: 18 }}>{selected.lead.name}</h2><p style={{ color: '#94a3b8', margin: '3px 0', fontSize: 12 }}>{selected.lead.company || 'No company'} | {selected.lead.email || selected.lead.phone}</p></div><button title="Close lead" onClick={() => setSelected(null)} style={{ ...button, background: 'transparent', padding: 5 }}><X size={18} /></button></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(230px,.8fr) minmax(360px,2fr)', gap: 14, marginTop: 14 }}>
        <div><div style={panel}><label style={{ color: '#94a3b8', fontSize: 12 }}>Status<select value={edit.status} onChange={e => setEdit({ ...edit, status: e.target.value })} style={{ ...input, marginTop: 5 }}>{statuses.map(value => <option key={value}>{value}</option>)}</select></label>
          {capabilities.assignment && <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginTop: 10 }}>Assignee user ID<input type="number" value={edit.assignedTo || ''} onChange={e => setEdit({ ...edit, assignedTo: e.target.value })} style={{ ...input, marginTop: 5 }} /></label>}
          {capabilities.notes && <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginTop: 10 }}>Notes<textarea rows={5} value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} style={{ ...input, marginTop: 5 }} /></label>}
          {capabilities.lossReason && <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginTop: 10 }}>Loss reason<textarea rows={3} value={edit.lossReason} onChange={e => setEdit({ ...edit, lossReason: e.target.value })} style={{ ...input, marginTop: 5 }} /></label>}
          <button onClick={() => void save()} style={{ ...button, marginTop: 12 }}><Save size={15} /> Save lead</button>
        </div><div style={{ ...panel, marginTop: 12 }}><h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Final user prompts</h3>{selected.conversation.finalUserPrompts.map((prompt: any) => <p key={prompt.id} style={{ color: '#cbd5e1', fontSize: 12, borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: 8 }}>{prompt.content}</p>)}</div></div>
        <div style={panel}><h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Conversation transcript</h3><div style={{ display: 'grid', gap: 8 }}>{selected.conversation.messages.map((message: any) => <div key={message.id} style={{ justifySelf: message.role === 'user' ? 'end' : 'start', maxWidth: '88%', background: message.role === 'user' ? '#164e63' : '#243147', borderRadius: 7, padding: '9px 11px', whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5 }}><strong style={{ display: 'block', color: '#94a3b8', fontSize: 10, marginBottom: 3 }}>{message.role}</strong>{message.content}</div>)}</div></div>
      </div>
    </div></div>}
  </div>;
}