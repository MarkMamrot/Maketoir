'use client';

import { Copy, ExternalLink, Eye, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 10px', boxSizing: 'border-box', background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 6, color: 'var(--sv-text-main)', fontSize: 14 };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 5, color: 'var(--sv-text-dim)', fontSize: 12, fontWeight: 600 };
const empty = {
  slug: '', displayName: '', logoUrl: '', shopifyReturnUrl: '', termsUrl: '', termsVersion: '1', privacyUrl: '',
  policyMode: 'hosted' as 'hosted' | 'external', isActive: false, currentPolicyVersionId: null as number | null,
  merchant: { legalName: '', tradingName: '', businessNumber: '', contactEmail: '', contactAddress: '', jurisdiction: 'New South Wales, Australia' },
};

export function LoyaltyPortalSettings() {
  const [draft, setDraft] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [policyApproved, setPolicyApproved] = useState(false);
  const [preview, setPreview] = useState<{ termsMarkdown: string; privacyMarkdown: string } | null>(null);
  const [previewTab, setPreviewTab] = useState<'terms' | 'privacy'>('terms');
  const portalUrl = draft.slug && typeof window !== 'undefined' ? `${window.location.origin}/rewards/${draft.slug}` : '';
  useEffect(() => { void fetch('/api/ims/loyalty/portal-profile').then(async response => {
    const body = await response.json();
    if (response.ok && body.profile) setDraft({ ...empty, ...body.profile, logoUrl: body.profile.logoUrl || '', merchant: { ...empty.merchant, ...(body.profile.merchant || {}) } });
    else if (!response.ok) setMessage({ error: true, text: body.error || 'Portal settings could not be loaded.' });
  }).finally(() => setLoading(false)); }, []);
  const change = (key: keyof typeof empty, value: string | boolean) => { setDraft(previous => ({ ...previous, [key]: value })); setPolicyApproved(false); setPreview(null); };
  const changeMerchant = (key: keyof typeof empty.merchant, value: string) => { setDraft(previous => ({ ...previous, merchant: { ...previous.merchant, [key]: value } })); setPolicyApproved(false); setPreview(null); };
  const previewPolicies = async () => {
    setSaving(true); setMessage(null);
    const response = await fetch('/api/ims/loyalty/portal-profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ merchant: draft.merchant }) });
    const body = await response.json().catch(() => ({}));
    if (response.ok) { setPreview(body.preview); setPreviewTab('terms'); }
    else setMessage({ error: true, text: body.error || 'Policy preview could not be generated.' });
    setSaving(false);
  };
  const save = async () => {
    setSaving(true); setMessage(null);
    const response = await fetch('/api/ims/loyalty/portal-profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, policyApproved }) });
    const body = await response.json().catch(() => ({}));
    if (response.ok) { setDraft({ ...empty, ...body.profile, logoUrl: body.profile.logoUrl || '', merchant: { ...empty.merchant, ...(body.profile.merchant || {}) } }); setMessage({ error: false, text: draft.isActive ? 'Portal and policy version published.' : 'Loyalty portal settings saved.' }); }
    else setMessage({ error: true, text: body.error || 'Portal settings could not be saved.' });
    setSaving(false);
  };
  if (loading) return <section style={{ marginTop: 16, padding: 20, border: '1px solid var(--sv-etch)', borderRadius: 8 }}>Loading portal settings...</section>;
  return <section style={{ marginTop: 16, padding: 20, background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 8 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, marginBottom: 18 }}><div><div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sv-text-strong)' }}>Customer rewards portal</div><div style={{ marginTop: 3, fontSize: 12, color: 'var(--sv-text-dim)' }}>Email sign-in, enrolment, balances, and Shopify discount conversion.</div></div><label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={draft.isActive} onChange={event => change('isActive', event.target.checked)} />{draft.isActive ? 'Published' : 'Off'}</label></div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
      <div><label style={labelStyle}>Portal address</label><input style={inputStyle} value={draft.slug} onChange={event => change('slug', event.target.value)} placeholder="your-store-rewards" /></div>
      <div><label style={labelStyle}>Display name</label><input style={inputStyle} value={draft.displayName} onChange={event => change('displayName', event.target.value)} /></div>
      <div><label style={labelStyle}>Logo URL (optional)</label><input type="url" style={inputStyle} value={draft.logoUrl} onChange={event => change('logoUrl', event.target.value)} placeholder="https://..." /></div>
      <div><label style={labelStyle}>Shopify store URL</label><input type="url" style={inputStyle} value={draft.shopifyReturnUrl} onChange={event => change('shopifyReturnUrl', event.target.value)} placeholder="https://your-store.myshopify.com" /></div>
      <div><label style={labelStyle}>Terms version</label><input style={inputStyle} value={draft.termsVersion} onChange={event => change('termsVersion', event.target.value)} /></div>
    </div>
    <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--sv-etch)' }}>
      <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 700, color: 'var(--sv-text-strong)' }}>Customer policies</div>
      <div style={{ display: 'inline-flex', padding: 3, background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 6, marginBottom: 16 }}>
        {(['hosted', 'external'] as const).map(mode => <button key={mode} type="button" onClick={() => change('policyMode', mode)} style={{ padding: '7px 12px', border: 0, borderRadius: 4, background: draft.policyMode === mode ? 'var(--sv-action)' : 'transparent', color: draft.policyMode === mode ? '#fff' : 'var(--sv-text-dim)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>{mode === 'hosted' ? 'Solvantis-hosted templates' : 'External URLs'}</button>)}
      </div>
      {draft.policyMode === 'hosted' ? <>
        <div style={{ marginBottom: 14, padding: 12, borderLeft: '3px solid var(--sv-action)', background: 'var(--sv-bg-1)', color: 'var(--sv-text-dim)', fontSize: 12, lineHeight: 1.5 }}>These Australian retail templates are a starting point, not legal advice. The business must review and approve each published version.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
          <div><label style={labelStyle}>Legal entity name</label><input style={inputStyle} value={draft.merchant.legalName} onChange={event => changeMerchant('legalName', event.target.value)} placeholder="Example Retail Pty Ltd" /></div>
          <div><label style={labelStyle}>Trading name</label><input style={inputStyle} value={draft.merchant.tradingName} onChange={event => changeMerchant('tradingName', event.target.value)} /></div>
          <div><label style={labelStyle}>ABN or business number</label><input style={inputStyle} value={draft.merchant.businessNumber} onChange={event => changeMerchant('businessNumber', event.target.value)} placeholder="ABN 12 345 678 901" /></div>
          <div><label style={labelStyle}>Privacy contact email</label><input type="email" style={inputStyle} value={draft.merchant.contactEmail} onChange={event => changeMerchant('contactEmail', event.target.value)} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Contact address</label><input style={inputStyle} value={draft.merchant.contactAddress} onChange={event => changeMerchant('contactAddress', event.target.value)} /></div>
          <div><label style={labelStyle}>Governing jurisdiction</label><input style={inputStyle} value={draft.merchant.jurisdiction} onChange={event => changeMerchant('jurisdiction', event.target.value)} /></div>
        </div>
        {draft.termsUrl && <div style={{ marginTop: 12, fontSize: 12, color: 'var(--sv-text-dim)' }}>Published terms: <a href={draft.termsUrl} target="_blank" style={{ color: 'var(--sv-action)' }}>{draft.termsUrl}</a><br />Published privacy: <a href={draft.privacyUrl} target="_blank" style={{ color: 'var(--sv-action)' }}>{draft.privacyUrl}</a></div>}
        <button type="button" onClick={previewPolicies} disabled={saving} style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 12px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', cursor: 'pointer', fontWeight: 700 }}><Eye size={15} />Preview policies</button>
      </> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
        <div><label style={labelStyle}>Loyalty terms URL</label><input type="url" style={inputStyle} value={draft.termsUrl} onChange={event => change('termsUrl', event.target.value)} placeholder="https://..." /></div>
        <div><label style={labelStyle}>Privacy policy URL</label><input type="url" style={inputStyle} value={draft.privacyUrl} onChange={event => change('privacyUrl', event.target.value)} placeholder="https://..." /></div>
      </div>}
      {draft.isActive && <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 16, color: 'var(--sv-text-main)', fontSize: 12, lineHeight: 1.5 }}><input type="checkbox" checked={policyApproved} onChange={event => setPolicyApproved(event.target.checked)} style={{ marginTop: 2 }} /><span>I have reviewed these policies for this business and approve publishing them as terms version <strong>{draft.termsVersion || '—'}</strong>.</span></label>}
    </div>
    {portalUrl && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 12, color: 'var(--sv-text-dim)', overflowWrap: 'anywhere' }}><span>{portalUrl}</span><button type="button" title="Copy portal URL" onClick={() => navigator.clipboard.writeText(portalUrl)} style={{ border: 0, background: 'transparent', color: 'var(--sv-text-main)', cursor: 'pointer' }}><Copy size={15} /></button>{draft.isActive && <a href={portalUrl} target="_blank" title="Open portal" style={{ color: 'var(--sv-action)' }}><ExternalLink size={15} /></a>}</div>}
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}><button type="button" onClick={save} disabled={saving || (draft.isActive && !policyApproved)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', border: 0, borderRadius: 6, background: 'var(--sv-action)', color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: saving || (draft.isActive && !policyApproved) ? .55 : 1 }}><Save size={15} />{saving ? 'Saving...' : draft.isActive ? 'Publish portal and policies' : 'Save portal'}</button>{message && <span style={{ fontSize: 12, color: message.error ? 'var(--sv-red)' : 'var(--sv-mint)' }}>{message.text}</span>}</div>
    {preview && <div onClick={event => { if (event.target === event.currentTarget) setPreview(null); }} style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(0,0,0,.65)' }}><div style={{ width: 'min(820px,100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 8 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 16, borderBottom: '1px solid var(--sv-etch)' }}><strong>Policy preview</strong><button type="button" onClick={() => setPreview(null)} style={{ border: 0, background: 'transparent', color: 'var(--sv-text-main)', cursor: 'pointer', fontSize: 18 }}>×</button></div><div style={{ display: 'flex', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--sv-etch)' }}>{(['terms', 'privacy'] as const).map(tab => <button type="button" key={tab} onClick={() => setPreviewTab(tab)} style={{ padding: '6px 10px', border: 0, borderRadius: 4, background: previewTab === tab ? 'var(--sv-action)' : 'var(--sv-bg-2)', color: previewTab === tab ? '#fff' : 'var(--sv-text-main)', cursor: 'pointer' }}>{tab === 'terms' ? 'Loyalty terms' : 'Privacy policy'}</button>)}</div><pre style={{ margin: 0, padding: 20, overflow: 'auto', whiteSpace: 'pre-wrap', color: 'var(--sv-text-main)', font: '13px/1.65 system-ui,sans-serif' }}>{previewTab === 'terms' ? preview.termsMarkdown : preview.privacyMarkdown}</pre></div></div>}
  </section>;
}