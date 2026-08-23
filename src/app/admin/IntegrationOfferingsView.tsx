'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Save, X } from 'lucide-react';

interface Offering {
  id: number; slug: string; name: string; category: string; deliveryMode: string; publicSummary: string;
  exampleProviders: string[]; supportedWorkflows: string[]; qualificationQuestions: string[];
  internalNotes: string | null; isEnabled: boolean; updatedAt?: string;
}

const categories = ['3pl_wms_fulfilment', 'ecommerce_marketplaces', 'accounting_erp', 'payments', 'shipping_carriers', 'supplier_edi', 'crm_marketing', 'loyalty_gift_cards', 'bi_warehouse', 'identity_customer_service', 'custom_api_webhook_file'];
const deliveryModes = ['native', 'on_demand', 'beta', 'not_offered'];
const emptyOffering: Omit<Offering, 'id'> = { slug: '', name: '', category: 'accounting_erp', deliveryMode: 'on_demand', publicSummary: '', exampleProviders: [], supportedWorkflows: [], qualificationQuestions: [], internalNotes: null, isEnabled: true };
const panel: React.CSSProperties = { background: '#172033', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: 16 };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#243147', border: '1px solid rgba(255,255,255,.14)', color: '#e2e8f0', borderRadius: 6, padding: '8px 10px', fontSize: 13 };
const button: React.CSSProperties = { border: 0, borderRadius: 6, padding: '7px 11px', background: '#1687a2', color: '#fff', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 };

function lines(value: string[]): string { return value.join('\n'); }
function array(value: string): string[] { return value.split('\n').map(item => item.trim()).filter(Boolean); }

export default function IntegrationOfferingsView() {
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [deliveryMode, setDeliveryMode] = useState('');
  const [editing, setEditing] = useState<(Omit<Offering, 'id'> & { id?: number }) | null>(null);
  const [draftArrays, setDraftArrays] = useState({ providers: '', workflows: '', questions: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    if (deliveryMode) params.set('deliveryMode', deliveryMode);
    try {
      const response = await fetch(`/api/admin/integration-offerings?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load offerings.');
      setOfferings(data.offerings || []);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Failed to load offerings.'); }
    finally { setLoading(false); }
  }, [category, deliveryMode, search]);

  useEffect(() => { void load(); }, [load]);

  const openEditor = (offering?: Offering) => {
    const value = offering ? { ...offering } : { ...emptyOffering };
    setEditing(value);
    setDraftArrays({ providers: lines(value.exampleProviders), workflows: lines(value.supportedWorkflows), questions: lines(value.qualificationQuestions) });
  };

  const save = async () => {
    if (!editing) return;
    setError('');
    const payload = { ...editing, exampleProviders: array(draftArrays.providers), supportedWorkflows: array(draftArrays.workflows), qualificationQuestions: array(draftArrays.questions) };
    const response = await fetch(editing.id ? `/api/admin/integration-offerings/${editing.id}` : '/api/admin/integration-offerings', {
      method: editing.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) { setError(data.error || 'Offering could not be saved.'); return; }
    setEditing(null); await load();
  };

  const toggle = async (offering: Offering) => {
    const response = await fetch(`/api/admin/integration-offerings/${offering.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...offering, isEnabled: !offering.isEnabled }),
    });
    if (!response.ok) { const data = await response.json(); setError(data.error || 'Offering could not be updated.'); return; }
    await load();
  };

  return <div style={{ maxWidth: 1400, margin: '0 auto' }}>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
      <div style={{ flex: 1, minWidth: 240 }}><h1 style={{ margin: 0, fontSize: 22 }}>Integration Offerings</h1><p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 13 }}>Public catalogue content and delivery status.</p></div>
      <button type="button" onClick={() => void load()} title="Refresh offerings" style={{ ...button, background: '#334155' }}><RefreshCw size={15} /> Refresh</button>
      <button type="button" onClick={() => openEditor()} style={button}><Plus size={15} /> New offering</button>
    </div>
    <div style={{ ...panel, display: 'grid', gridTemplateColumns: 'minmax(220px,2fr) repeat(2,minmax(170px,1fr))', gap: 10, marginBottom: 12 }}>
      <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, slug, or summary" style={input} />
      <select value={category} onChange={event => setCategory(event.target.value)} style={input}><option value="">All categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select>
      <select value={deliveryMode} onChange={event => setDeliveryMode(event.target.value)} style={input}><option value="">All delivery modes</option>{deliveryModes.map(value => <option key={value}>{value}</option>)}</select>
    </div>
    {error && <p style={{ color: '#fca5a5', fontSize: 13 }}>{error}</p>}
    <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}><thead><tr>{['Offering', 'Category', 'Delivery', 'Providers', 'Public', 'Updated', ''].map(label => <th key={label} style={{ textAlign: 'left', padding: '9px 12px', color: '#94a3b8', fontSize: 11, background: '#243147', borderBottom: '1px solid rgba(255,255,255,.1)' }}>{label}</th>)}</tr></thead>
        <tbody>{offerings.map(offering => <tr key={offering.id} style={{ borderBottom: '1px solid rgba(255,255,255,.07)' }}>
          <td style={{ padding: 12 }}><button onClick={() => openEditor(offering)} style={{ border: 0, padding: 0, background: 'none', color: '#e2e8f0', cursor: 'pointer', textAlign: 'left', fontWeight: 700 }}>{offering.name}</button><div style={{ color: '#64748b', fontSize: 11 }}>{offering.slug}</div></td>
          <td style={{ padding: 12, fontSize: 12 }}>{offering.category}</td><td style={{ padding: 12, fontSize: 12 }}>{offering.deliveryMode}</td>
          <td style={{ padding: 12, fontSize: 12 }}>{offering.exampleProviders.join(', ') || 'None'}</td>
          <td style={{ padding: 12 }}><button onClick={() => void toggle(offering)} style={{ ...button, background: offering.isEnabled ? '#166534' : '#475569', padding: '4px 9px', fontSize: 11 }}>{offering.isEnabled ? 'Enabled' : 'Disabled'}</button></td>
          <td style={{ padding: 12, color: '#94a3b8', fontSize: 12 }}>{offering.updatedAt ? new Date(offering.updatedAt).toLocaleString() : ''}</td>
          <td style={{ padding: 12 }}><button onClick={() => openEditor(offering)} style={{ ...button, background: '#334155', padding: '5px 9px' }}>Edit</button></td>
        </tr>)}</tbody></table>
      {loading && <p style={{ padding: 16, color: '#94a3b8' }}>Loading offerings...</p>}
      {!loading && !offerings.length && <p style={{ padding: 16, color: '#94a3b8' }}>No offerings match these filters.</p>}
    </div>
    {editing && <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,.8)', padding: 20, display: 'grid', placeItems: 'center' }}>
      <div style={{ ...panel, width: 'min(760px,100%)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}><h2 style={{ margin: 0, fontSize: 18 }}>{editing.id ? 'Edit offering' : 'New offering'}</h2><button onClick={() => setEditing(null)} title="Close editor" style={{ ...button, background: 'transparent', padding: 5 }}><X size={18} /></button></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>Name<input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} style={{ ...input, marginTop: 5 }} /></label>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>Slug<input value={editing.slug} onChange={e => setEditing({ ...editing, slug: e.target.value })} style={{ ...input, marginTop: 5 }} /></label>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>Category<select value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })} style={{ ...input, marginTop: 5 }}>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>Delivery<select value={editing.deliveryMode} onChange={e => setEditing({ ...editing, deliveryMode: e.target.value })} style={{ ...input, marginTop: 5 }}>{deliveryModes.map(value => <option key={value}>{value}</option>)}</select></label>
        </div>
        <label style={{ display: 'block', marginTop: 12, fontSize: 12, color: '#94a3b8' }}>Public summary<textarea value={editing.publicSummary} onChange={e => setEditing({ ...editing, publicSummary: e.target.value })} rows={4} style={{ ...input, marginTop: 5, resize: 'vertical' }} /></label>
        {[['Example providers', 'providers'], ['Supported workflows', 'workflows'], ['Qualification questions', 'questions']].map(([label, key]) => <label key={key} style={{ display: 'block', marginTop: 12, fontSize: 12, color: '#94a3b8' }}>{label} (one per line)<textarea value={draftArrays[key as keyof typeof draftArrays]} onChange={e => setDraftArrays({ ...draftArrays, [key]: e.target.value })} rows={3} style={{ ...input, marginTop: 5, resize: 'vertical' }} /></label>)}
        <label style={{ display: 'block', marginTop: 12, fontSize: 12, color: '#94a3b8' }}>Internal notes<textarea value={editing.internalNotes || ''} onChange={e => setEditing({ ...editing, internalNotes: e.target.value || null })} rows={3} style={{ ...input, marginTop: 5, resize: 'vertical' }} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13 }}><input type="checkbox" checked={editing.isEnabled} onChange={e => setEditing({ ...editing, isEnabled: e.target.checked })} /> Publicly enabled</label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}><button onClick={() => setEditing(null)} style={{ ...button, background: '#334155' }}>Cancel</button><button onClick={() => void save()} style={button}><Save size={15} /> Save</button></div>
      </div>
    </div>}
  </div>;
}