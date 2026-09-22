'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Check, RefreshCw, X } from 'lucide-react';

type Status = 'pending_review' | 'approved' | 'rejected';
interface Application {
  id: number;
  flow_type: 'new_user' | 'existing_user';
  business_name: string;
  website: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  business_type: string | null;
  location_count_band: string | null;
  channels: string | null;
  revenue_band: string | null;
  country: string | null;
  abn: string | null;
  notes: string | null;
  status: Status;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  resulting_business_id: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<Status, string> = {
  pending_review: 'Ready for review', approved: 'Approved', rejected: 'Rejected',
};

export function BusinessApplicationsQueue() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | Status>('pending_review');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [hasForesight, setHasForesight] = useState(true);
  const [hasIms, setHasIms] = useState(true);
  const [hasPos, setHasPos] = useState(true);
  const [aiPlanKey, setAiPlanKey] = useState('starter');
  const [maxLocations, setMaxLocations] = useState('');
  const [maxUsers, setMaxUsers] = useState('');
  const [costPerLocation, setCostPerLocation] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/business-applications');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Applications could not be loaded.');
      setApplications(data.applications ?? []);
      setSelectedId(current => current && data.applications.some((item: Application) => item.id === current)
        ? current
        : data.applications.find((item: Application) => item.status === 'pending_review')?.id ?? data.applications[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Applications could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = applications.find(item => item.id === selectedId) ?? null;
  const visible = filter === 'all' ? applications : applications.filter(item => item.status === filter);

  async function approve() {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/business-applications/${selected.id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hasForesight, hasIms, hasPos, aiPlanKey,
          maxLocations: maxLocations.trim() === '' ? null : Number(maxLocations),
          maxUsers: maxUsers.trim() === '' ? null : Number(maxUsers),
          costPerLocation: costPerLocation.trim() === '' ? null : Number(costPerLocation),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Application could not be approved.');
      await load();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'Application approval failed.');
    } finally {
      setSaving(false);
    }
  }

  async function reject() {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/business-applications/${selected.id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectionReason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Application could not be rejected.');
      setRejectionReason('');
      await load();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'Application rejection failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ padding: 24, color: 'var(--sv-text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div><h1 style={{ margin: 0, fontSize: 24 }}>Business Applications</h1><p style={{ margin: '5px 0 0', color: 'var(--sv-text-dim)', fontSize: 13 }}>New signups and existing-Admin requests awaiting activation.</p></div>
        <button type="button" onClick={() => void load()} title="Refresh applications" style={iconButtonStyle}><RefreshCw size={17} /></button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
        {(['pending_review', 'approved', 'rejected', 'all'] as const).map(status => (
          <button key={status} type="button" onClick={() => setFilter(status)} style={{ ...filterButtonStyle, background: filter === status ? 'var(--sv-action)' : 'var(--sv-bg-1)', color: filter === status ? '#fff' : 'var(--sv-text)' }}>
            {status === 'all' ? 'All' : STATUS_LABEL[status]}
          </button>
        ))}
      </div>
      {error && <div role="alert" style={{ padding: 12, border: '1px solid #dc9b91', background: '#fff2f0', color: '#8f2f24', marginBottom: 16 }}>{error}</div>}
      {loading ? <p>Loading applications...</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 0.8fr) minmax(360px, 1.2fr)', gap: 0, border: '1px solid var(--sv-border)', background: 'var(--sv-bg-1)' }} className="business-application-layout">
          <div style={{ borderRight: '1px solid var(--sv-border)', minHeight: 420 }}>
            {visible.length === 0 && <p style={{ padding: 20, color: 'var(--sv-text-dim)' }}>No applications in this status.</p>}
            {visible.map(application => (
              <button key={application.id} type="button" onClick={() => setSelectedId(application.id)} style={{ width: '100%', textAlign: 'left', padding: '14px 16px', border: 0, borderBottom: '1px solid var(--sv-border)', background: selectedId === application.id ? 'rgba(37,99,235,.1)' : 'transparent', color: 'var(--sv-text)', cursor: 'pointer' }}>
                <strong style={{ display: 'block' }}>{application.business_name}</strong>
                <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--sv-text-dim)' }}>
                  {application.flow_type === 'new_user' ? `${application.contact_name || 'New user'} · ${application.contact_email || ''}` : 'Existing business · Add new business'}
                </span>
                <span style={{ display: 'inline-block', marginTop: 8, fontSize: 11, fontWeight: 700 }}>{STATUS_LABEL[application.status]}</span>
              </button>
            ))}
          </div>
          <div style={{ padding: 22 }}>
            {!selected ? <p style={{ color: 'var(--sv-text-dim)' }}>Select an application.</p> : <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Building2 size={22} /><h2 style={{ margin: 0, fontSize: 20 }}>{selected.business_name}</h2></div>
              <dl style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '10px 16px', margin: '20px 0', fontSize: 13 }}>
                {selected.flow_type === 'new_user' && <>
                  <dt style={termStyle}>Contact</dt><dd style={valueStyle}>{selected.contact_name || 'Not provided'}</dd>
                  <dt style={termStyle}>Email</dt><dd style={valueStyle}>{selected.contact_email || 'Not provided'}</dd>
                  <dt style={termStyle}>Phone</dt><dd style={valueStyle}>{selected.contact_phone || 'Not provided'}</dd>
                </>}
                <dt style={termStyle}>Flow</dt><dd style={valueStyle}>{selected.flow_type === 'new_user' ? 'New registrant' : 'Existing Admin — additional business'}</dd>
                <dt style={termStyle}>Website</dt><dd style={valueStyle}>{selected.website ? <a href={selected.website} target="_blank" rel="noopener noreferrer">{selected.website}</a> : 'Not provided'}</dd>
                <dt style={termStyle}>Business type</dt><dd style={valueStyle}>{selected.business_type || 'Not provided'}</dd>
                <dt style={termStyle}>Locations</dt><dd style={valueStyle}>{selected.location_count_band || 'Not provided'}</dd>
                <dt style={termStyle}>Channels</dt><dd style={valueStyle}>{selected.channels || 'Not provided'}</dd>
                <dt style={termStyle}>Revenue</dt><dd style={valueStyle}>{selected.revenue_band || 'Not provided'}</dd>
                <dt style={termStyle}>Country</dt><dd style={valueStyle}>{selected.country || 'Not provided'}</dd>
                <dt style={termStyle}>ABN</dt><dd style={valueStyle}>{selected.abn || 'Not provided'}</dd>
                <dt style={termStyle}>Applied</dt><dd style={valueStyle}>{new Date(selected.created_at).toLocaleString('en-AU')}</dd>
                <dt style={termStyle}>Notes</dt><dd style={valueStyle}>{selected.notes || 'No notes'}</dd>
              </dl>
              {selected.status === 'pending_review' && <>
                <div style={{ borderTop: '1px solid var(--sv-border)', paddingTop: 18 }}>
                  <strong style={{ fontSize: 13 }}>Module Access</strong>
                  <div style={{ marginTop: 9, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 12 }}><input type="checkbox" checked={hasForesight} onChange={e => setHasForesight(e.target.checked)} /> Intel & Automation</label>
                    <label style={{ fontSize: 12 }}><input type="checkbox" checked={hasIms} onChange={e => setHasIms(e.target.checked)} /> IMS</label>
                    <label style={{ fontSize: 12 }}><input type="checkbox" checked={hasPos} onChange={e => setHasPos(e.target.checked)} /> POS</label>
                  </div>
                  <label style={{ display: 'block', marginTop: 14, fontSize: 13 }}>Solvantis AI Plan
                    <select value={aiPlanKey} onChange={e => setAiPlanKey(e.target.value)} style={inputStyle}>
                      <option value="starter">Starter</option>
                      <option value="core">Core</option>
                      <option value="scale">Scale</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
                    <label style={{ fontSize: 12 }}>Max Locations<input type="number" min={1} value={maxLocations} onChange={e => setMaxLocations(e.target.value)} placeholder="Unlimited" style={inputStyle} /></label>
                    <label style={{ fontSize: 12 }}>Max Users<input type="number" min={1} value={maxUsers} onChange={e => setMaxUsers(e.target.value)} placeholder="Unlimited" style={inputStyle} /></label>
                    <label style={{ fontSize: 12 }}>Cost / Location<input type="number" min={0} step={0.01} value={costPerLocation} onChange={e => setCostPerLocation(e.target.value)} placeholder="0.00" style={inputStyle} /></label>
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                    <button type="button" disabled={saving} onClick={() => void approve()} style={{ ...actionButtonStyle, background: '#28734f' }}><Check size={16} /> Approve & Provision</button>
                  </div>
                  <label style={{ display: 'block', marginTop: 20, fontSize: 13 }}>Rejection reason<textarea value={rejectionReason} maxLength={1000} rows={3} onChange={event => setRejectionReason(event.target.value)} style={{ ...inputStyle, height: 'auto', paddingTop: 8 }} /></label>
                  <button type="button" disabled={saving || !rejectionReason.trim()} onClick={() => void reject()} style={{ ...actionButtonStyle, marginTop: 10, background: '#9b3d30' }}><X size={16} /> Reject</button>
                </div>
              </>}
              {selected.reviewed_at && <p style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>Reviewed by {selected.reviewed_by_name || 'staff'} on {new Date(selected.reviewed_at).toLocaleString('en-AU')}{selected.review_reason ? `: ${selected.review_reason}` : ''}</p>}
              {selected.resulting_business_id && <p style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>Provisioned business: {selected.resulting_business_id}</p>}
            </>}
          </div>
        </div>
      )}
      <style jsx>{`@media (max-width: 800px) { .business-application-layout { grid-template-columns: 1fr !important; } .business-application-layout > div:first-child { border-right: 0 !important; border-bottom: 1px solid var(--sv-border); min-height: 0 !important; max-height: 300px; overflow-y: auto; } }`}</style>
    </section>
  );
}

const iconButtonStyle = { width: 36, height: 36, display: 'grid', placeItems: 'center', border: '1px solid var(--sv-border)', background: 'var(--sv-bg-1)', color: 'var(--sv-text)', cursor: 'pointer' } as const;
const filterButtonStyle = { border: '1px solid var(--sv-border)', padding: '7px 11px', fontSize: 12, cursor: 'pointer' } as const;
const actionButtonStyle = { border: 0, color: '#fff', padding: '9px 14px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' } as const;
const inputStyle = { display: 'block', width: '100%', height: 36, marginTop: 6, border: '1px solid var(--sv-border)', background: 'var(--sv-bg-0)', color: 'var(--sv-text)', padding: '0 9px' } as const;
const termStyle = { color: 'var(--sv-text-dim)' } as const;
const valueStyle = { margin: 0, overflowWrap: 'anywhere' } as const;
