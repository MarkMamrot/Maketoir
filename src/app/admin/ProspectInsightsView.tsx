'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const panel: React.CSSProperties = { background: '#172033', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: 14 };
const input: React.CSSProperties = { background: '#243147', border: '1px solid rgba(255,255,255,.14)', color: '#e2e8f0', borderRadius: 6, padding: '7px 9px', fontSize: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 10, color: '#94a3b8', background: '#243147' };
const td: React.CSSProperties = { padding: '9px 10px', fontSize: 12, borderTop: '1px solid rgba(255,255,255,.07)', verticalAlign: 'top' };

type InsightRow = Record<string, unknown>;
interface ProspectInsightsResponse {
  funnel: { totalConversations: number; totalLeads: number; conversionRate: number; leads: InsightRow[] };
  abandonedConversations: InsightRow[]; highIntentConversations: InsightRow[]; topEventTypes: InsightRow[];
  integrations: InsightRow[]; finalPromptClusters: InsightRow[]; demandInsights: InsightRow[];
}

function Table({ columns, rows }: { columns: Array<[string, string]>; rows: InsightRow[] }) {
  return <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}><thead><tr>{columns.map(([key, label]) => <th key={key} style={th}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || row.event_type || row.provider || row.cluster || `${row.status}-${index}`}>{columns.map(([key]) => <td key={key} style={td}>{key.includes('at') && row[key] ? new Date(row[key]).toLocaleString() : String(row[key] ?? '')}</td>)}</tr>)}</tbody></table>{!rows.length && <p style={{ color: '#94a3b8', fontSize: 12, padding: '0 10px' }}>No data in this period.</p>}</div>;
}

export default function ProspectInsightsView() {
  const [filters, setFilters] = useState({ from: '', to: '' });
  const [data, setData] = useState<ProspectInsightsResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError(''); const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    try { const response = await fetch(`/api/admin/prospect-insights?${params}`); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Failed to load insights.'); setData(result); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Failed to load insights.'); } finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { void load(); }, [load]);
  return <div style={{ maxWidth: 1500, margin: '0 auto' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}><div style={{ flex: 1, minWidth: 220 }}><h1 style={{ margin: 0, fontSize: 22 }}>Prospect Insights</h1><p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 13 }}>Assistant demand, intent, and lead conversion signals.</p></div><input type="date" aria-label="Insights from" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} style={input} /><input type="date" aria-label="Insights to" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} style={input} /><button onClick={() => void load()} style={{ border: 0, borderRadius: 6, padding: '7px 10px', background: '#334155', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><RefreshCw size={15} /> Refresh</button></div>
    {error && <p style={{ color: '#fca5a5', fontSize: 13 }}>{error}</p>}{loading && <p style={{ color: '#94a3b8' }}>Loading prospect insights...</p>}
    {data && <><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginBottom: 12 }}>{[['Conversations', data.funnel.totalConversations], ['Leads', data.funnel.totalLeads], ['Conversion', `${(data.funnel.conversionRate * 100).toFixed(1)}%`], ['Abandoned', data.abandonedConversations.length], ['High intent', data.highIntentConversations.length]].map(([label, value]) => <div key={String(label)} style={panel}><div style={{ color: '#94a3b8', fontSize: 11 }}>{label}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 5 }}>{value}</div></div>)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(420px,1fr))', gap: 12 }}>
        <section style={panel}><h2 style={{ fontSize: 14, margin: '0 0 10px' }}>Lead funnel</h2><Table columns={[["status","Status"],["count","Count"]]} rows={data.funnel.leads} /></section>
        <section style={panel}><h2 style={{ fontSize: 14, margin: '0 0 10px' }}>Top event types</h2><Table columns={[["event_type","Event"],["count","Count"]]} rows={data.topEventTypes} /></section>
        <section style={{ ...panel, gridColumn: '1 / -1' }}><h2 style={{ fontSize: 14, margin: '0 0 10px' }}>Integration and provider interest</h2><Table columns={[["provider","Provider"],["offering_name","Offering"],["category","Category"],["event_count","Events"],["conversation_count","Conversations"],["last_seen_at","Last seen"]]} rows={data.integrations} /></section>
        <section style={panel}><h2 style={{ fontSize: 14, margin: '0 0 10px' }}>High-intent conversations without a lead</h2><Table columns={[["last_user_prompt","Final prompt"],["source_path","Source"],["message_count","Messages"],["intent_seen_at","Intent seen"]]} rows={data.highIntentConversations} /></section>
        <section style={panel}><h2 style={{ fontSize: 14, margin: '0 0 10px' }}>Abandoned conversations</h2><Table columns={[["last_user_prompt","Final prompt"],["source_path","Source"],["message_count","Messages"],["updated_at","Updated"]]} rows={data.abandonedConversations} /></section>
        <section style={panel}><h2 style={{ fontSize: 14, margin: '0 0 10px' }}>Final prompt clusters</h2><Table columns={[["cluster","Cluster"],["intent","Intent"],["conversation_count","Conversations"],["sample_prompt","Sample prompt"]]} rows={data.finalPromptClusters} /></section>
        <section style={panel}><h2 style={{ fontSize: 14, margin: '0 0 10px' }}>Demand insights</h2><Table columns={[["demand_type","Type"],["requested_name","Request"],["requested_provider","Provider"],["occurrence_count","Occurrences"],["conversation_count","Conversations"]]} rows={data.demandInsights} /></section>
      </div></>}
  </div>;
}