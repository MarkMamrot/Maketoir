'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Check, RefreshCw, X } from 'lucide-react';

type Status = 'pending_email' | 'pending_review' | 'approving' | 'approved' | 'rejected';
interface Application {
  id: number; companyName: string; contactName: string; email: string; phone: string | null;
  abn: string | null; message: string | null; status: Status; emailVerifiedAt: string | null;
  linkedContactId: number | null; reviewedByName: string | null; reviewedAt: string | null;
  reviewReason: string | null; createdAt: string;
}

const STATUS_LABEL: Record<Status, string> = {
  pending_email: 'Awaiting email', pending_review: 'Ready for review', approving: 'Approval processing',
  approved: 'Approved', rejected: 'Rejected',
};

export function WholesaleApplicationQueue({ isAdvisor }: { isAdvisor: boolean }) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | Status>('pending_review');
  const [canReview, setCanReview] = useState(false);
  const [brands, setBrands] = useState<string[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[] | null>(null);
  const [accountLimit, setAccountLimit] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/ims/wholesale/applications');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Applications could not be loaded.');
      setApplications(data.applications ?? []);
      setCanReview(Boolean(data.canReview) && !isAdvisor);
      setSelectedId(current => current && data.applications.some((item: Application) => item.id === current)
        ? current
        : data.applications.find((item: Application) => item.status === 'pending_review')?.id ?? data.applications[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Applications could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [isAdvisor]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    fetch('/api/ims/wholesale-brands').then(response => response.json()).then(data => setBrands(data.brands ?? [])).catch(() => {});
  }, []);

  const selected = applications.find(item => item.id === selectedId) ?? null;
  const visible = filter === 'all' ? applications : applications.filter(item => item.status === filter);

  async function decide(decision: 'approve' | 'reject') {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/ims/wholesale/applications/${selected.id}/${decision}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decision === 'approve'
          ? { allowedBrands: selectedBrands, onAccountLimit: accountLimit }
          : { reason: rejectionReason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Application could not be ${decision}d.`);
      setRejectionReason('');
      await load();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'Application review failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ padding: 24, color: 'var(--sv-text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div><h1 style={{ margin: 0, fontSize: 24 }}>Wholesale Applications</h1><p style={{ margin: '5px 0 0', color: 'var(--sv-text-dim)', fontSize: 13 }}>Verified buyer applications awaiting supplier review.</p></div>
        <button type="button" onClick={() => void load()} title="Refresh applications" style={iconButtonStyle}><RefreshCw size={17} /></button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
        {(['pending_review', 'pending_email', 'approved', 'rejected', 'all'] as const).map(status => (
          <button key={status} type="button" onClick={() => setFilter(status)} style={{ ...filterButtonStyle, background: filter === status ? 'var(--sv-action)' : 'var(--sv-bg-1)', color: filter === status ? '#fff' : 'var(--sv-text)' }}>
            {status === 'all' ? 'All' : STATUS_LABEL[status]}
          </button>
        ))}
      </div>
      {error && <div role="alert" style={{ padding: 12, border: '1px solid #dc9b91', background: '#fff2f0', color: '#8f2f24', marginBottom: 16 }}>{error}</div>}
      {loading ? <p>Loading applications...</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 0.8fr) minmax(360px, 1.2fr)', gap: 0, border: '1px solid var(--sv-border)', background: 'var(--sv-bg-1)' }} className="wholesale-application-layout">
          <div style={{ borderRight: '1px solid var(--sv-border)', minHeight: 420 }}>
            {visible.length === 0 && <p style={{ padding: 20, color: 'var(--sv-text-dim)' }}>No applications in this status.</p>}
            {visible.map(application => (
              <button key={application.id} type="button" onClick={() => setSelectedId(application.id)} style={{ width: '100%', textAlign: 'left', padding: '14px 16px', border: 0, borderBottom: '1px solid var(--sv-border)', background: selectedId === application.id ? 'rgba(37,99,235,.1)' : 'transparent', color: 'var(--sv-text)', cursor: 'pointer' }}>
                <strong style={{ display: 'block' }}>{application.companyName}</strong>
                <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--sv-text-dim)' }}>{application.contactName} · {application.email}</span>
                <span style={{ display: 'inline-block', marginTop: 8, fontSize: 11, fontWeight: 700 }}>{STATUS_LABEL[application.status]}</span>
              </button>
            ))}
          </div>
          <div style={{ padding: 22 }}>
            {!selected ? <p style={{ color: 'var(--sv-text-dim)' }}>Select an application.</p> : <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Building2 size={22} /><h2 style={{ margin: 0, fontSize: 20 }}>{selected.companyName}</h2></div>
              <dl style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '10px 16px', margin: '20px 0', fontSize: 13 }}>
                <dt style={termStyle}>Contact</dt><dd style={valueStyle}>{selected.contactName}</dd>
                <dt style={termStyle}>Email</dt><dd style={valueStyle}>{selected.email}</dd>
                <dt style={termStyle}>Phone</dt><dd style={valueStyle}>{selected.phone || 'Not provided'}</dd>
                <dt style={termStyle}>ABN</dt><dd style={valueStyle}>{selected.abn || 'Not provided'}</dd>
                <dt style={termStyle}>Applied</dt><dd style={valueStyle}>{new Date(selected.createdAt).toLocaleString('en-AU')}</dd>
                <dt style={termStyle}>Message</dt><dd style={valueStyle}>{selected.message || 'No message'}</dd>
              </dl>
              {selected.status === 'pending_review' && canReview && <>
                <div style={{ borderTop: '1px solid var(--sv-border)', paddingTop: 18 }}>
                  <strong style={{ fontSize: 13 }}>Brand access</strong>
                  <div style={{ marginTop: 9, display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => setSelectedBrands(null)} style={smallButtonStyle}>Allow all</button>
                    <button type="button" onClick={() => setSelectedBrands([])} style={smallButtonStyle}>Allow none</button>
                  </div>
                  {selectedBrands !== null && brands.length > 0 && <div style={{ maxHeight: 140, overflowY: 'auto', marginTop: 10, border: '1px solid var(--sv-border)', padding: 10 }}>
                    {brands.map(brand => <label key={brand} style={{ display: 'block', padding: '3px 0', fontSize: 12 }}><input type="checkbox" checked={selectedBrands.includes(brand)} onChange={event => setSelectedBrands(current => event.target.checked ? [...(current ?? []), brand] : (current ?? []).filter(item => item !== brand))} /> {brand}</label>)}
                  </div>}
                  <label style={{ display: 'block', marginTop: 14, fontSize: 13 }}>Account limit ($)<input type="number" min="0" step="0.01" value={accountLimit} onChange={event => setAccountLimit(event.target.value)} style={inputStyle} /></label>
                  <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                    <button type="button" disabled={saving} onClick={() => void decide('approve')} style={{ ...actionButtonStyle, background: '#28734f' }}><Check size={16} /> Approve</button>
                  </div>
                  <label style={{ display: 'block', marginTop: 20, fontSize: 13 }}>Rejection reason<textarea value={rejectionReason} maxLength={1000} rows={3} onChange={event => setRejectionReason(event.target.value)} style={{ ...inputStyle, height: 'auto', paddingTop: 8 }} /></label>
                  <button type="button" disabled={saving || !rejectionReason.trim()} onClick={() => void decide('reject')} style={{ ...actionButtonStyle, marginTop: 10, background: '#9b3d30' }}><X size={16} /> Reject</button>
                </div>
              </>}
              {selected.status === 'pending_review' && !canReview && <p style={{ color: 'var(--sv-text-dim)', fontSize: 13 }}>Admin access is required to approve or reject applications.</p>}
              {selected.reviewedAt && <p style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>Reviewed by {selected.reviewedByName || 'staff'} on {new Date(selected.reviewedAt).toLocaleString('en-AU')}{selected.reviewReason ? `: ${selected.reviewReason}` : ''}</p>}
            </>}
          </div>
        </div>
      )}
      <style jsx>{`@media (max-width: 800px) { .wholesale-application-layout { grid-template-columns: 1fr !important; } .wholesale-application-layout > div:first-child { border-right: 0 !important; border-bottom: 1px solid var(--sv-border); min-height: 0 !important; max-height: 300px; overflow-y: auto; } }`}</style>
    </section>
  );
}

const iconButtonStyle = { width: 36, height: 36, display: 'grid', placeItems: 'center', border: '1px solid var(--sv-border)', background: 'var(--sv-bg-1)', color: 'var(--sv-text)', cursor: 'pointer' } as const;
const filterButtonStyle = { border: '1px solid var(--sv-border)', padding: '7px 11px', fontSize: 12, cursor: 'pointer' } as const;
const smallButtonStyle = { border: '1px solid var(--sv-border)', background: 'var(--sv-bg-1)', color: 'var(--sv-text)', padding: '6px 9px', fontSize: 12, cursor: 'pointer' } as const;
const actionButtonStyle = { border: 0, color: '#fff', padding: '9px 14px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' } as const;
const inputStyle = { display: 'block', width: '100%', height: 36, marginTop: 6, border: '1px solid var(--sv-border)', background: 'var(--sv-bg-0)', color: 'var(--sv-text)', padding: '0 9px' } as const;
const termStyle = { color: 'var(--sv-text-dim)' } as const;
const valueStyle = { margin: 0, overflowWrap: 'anywhere' } as const;