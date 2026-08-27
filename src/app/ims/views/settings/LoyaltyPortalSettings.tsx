'use client';

import { Copy, ExternalLink, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 10px', boxSizing: 'border-box', background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 6, color: 'var(--sv-text-main)', fontSize: 14 };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 5, color: 'var(--sv-text-dim)', fontSize: 12, fontWeight: 600 };
const empty = { slug: '', displayName: '', logoUrl: '', shopifyReturnUrl: '', termsUrl: '', termsVersion: '1', privacyUrl: '', isActive: false };

export function LoyaltyPortalSettings() {
  const [draft, setDraft] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const portalUrl = draft.slug && typeof window !== 'undefined' ? `${window.location.origin}/rewards/${draft.slug}` : '';
  useEffect(() => { void fetch('/api/ims/loyalty/portal-profile').then(async response => {
    const body = await response.json();
    if (response.ok && body.profile) setDraft({ ...body.profile, logoUrl: body.profile.logoUrl || '' });
    else if (!response.ok) setMessage({ error: true, text: body.error || 'Portal settings could not be loaded.' });
  }).finally(() => setLoading(false)); }, []);
  const change = (key: keyof typeof empty, value: string | boolean) => setDraft(previous => ({ ...previous, [key]: value }));
  const save = async () => {
    setSaving(true); setMessage(null);
    const response = await fetch('/api/ims/loyalty/portal-profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
    const body = await response.json().catch(() => ({}));
    if (response.ok) { setDraft({ ...body.profile, logoUrl: body.profile.logoUrl || '' }); setMessage({ error: false, text: 'Loyalty portal settings saved.' }); }
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
      <div><label style={labelStyle}>Loyalty terms URL</label><input type="url" style={inputStyle} value={draft.termsUrl} onChange={event => change('termsUrl', event.target.value)} /></div>
      <div><label style={labelStyle}>Terms version</label><input style={inputStyle} value={draft.termsVersion} onChange={event => change('termsVersion', event.target.value)} /></div>
      <div><label style={labelStyle}>Privacy policy URL</label><input type="url" style={inputStyle} value={draft.privacyUrl} onChange={event => change('privacyUrl', event.target.value)} /></div>
    </div>
    {portalUrl && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 12, color: 'var(--sv-text-dim)', overflowWrap: 'anywhere' }}><span>{portalUrl}</span><button type="button" title="Copy portal URL" onClick={() => navigator.clipboard.writeText(portalUrl)} style={{ border: 0, background: 'transparent', color: 'var(--sv-text-main)', cursor: 'pointer' }}><Copy size={15} /></button>{draft.isActive && <a href={portalUrl} target="_blank" title="Open portal" style={{ color: 'var(--sv-action)' }}><ExternalLink size={15} /></a>}</div>}
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}><button type="button" onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', border: 0, borderRadius: 6, background: 'var(--sv-action)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}><Save size={15} />{saving ? 'Saving...' : 'Save portal'}</button>{message && <span style={{ fontSize: 12, color: message.error ? 'var(--sv-red)' : 'var(--sv-mint)' }}>{message.text}</span>}</div>
  </section>;
}