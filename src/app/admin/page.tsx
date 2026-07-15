'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Business {
  business_id: string; name: string; drive_folder_id: string | null;
  has_foresight: number; has_ims: number; has_pos: number;
  max_locations: number | null; max_users: number | null; cost_per_location: number | null;
  created_at: string; deleted_at: string | null;
}
interface User {
  id: number; name: string | null; email: string; tier: string; business_id: string | null;
  created_at?: string;
}

type View = 'businesses' | 'users';

// ── Styles (IMS-style) ────────────────────────────────────────────────────────
const S = {
  page:   { minHeight: '100vh', background: 'var(--sv-bg-0,#0f172a)', color: 'var(--sv-text-main,#e2e8f0)', fontFamily: 'system-ui,sans-serif', display: 'flex', flexDirection: 'column' as const },
  topbar: { height: 48, background: 'var(--sv-bg-1,#1e293b)', borderBottom: '1px solid var(--sv-etch,rgba(255,255,255,.1))', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0 },
  body:   { flex: 1, display: 'flex', overflow: 'hidden' },
  sidebar:{ width: 200, background: 'var(--sv-bg-1,#1e293b)', borderRight: '1px solid var(--sv-etch,rgba(255,255,255,.1))', padding: '12px 8px', display: 'flex', flexDirection: 'column' as const, gap: 4, flexShrink: 0 },
  main:   { flex: 1, overflow: 'auto', padding: 24 },
  navBtn: (active: boolean): React.CSSProperties => ({
    width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
    background: active ? 'var(--sv-action,#3b82f6)' : 'none',
    color: active ? '#fff' : 'var(--sv-text-dim,#94a3b8)',
    fontWeight: active ? 700 : 400, fontSize: 13,
  }),
  card:   { background: 'var(--sv-bg-1,#1e293b)', border: '1px solid var(--sv-etch,rgba(255,255,255,.1))', borderRadius: 10, padding: '14px 18px', marginBottom: 10 },
  input:  { width: '100%', padding: '8px 10px', background: 'var(--sv-bg-2,#334155)', border: '1px solid var(--sv-etch,rgba(255,255,255,.15))', borderRadius: 7, color: 'var(--sv-text-main,#e2e8f0)', fontSize: 13, boxSizing: 'border-box' as const },
  btn:    (variant: 'action'|'red'|'ghost'): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 7, border: variant === 'ghost' ? '1px solid var(--sv-etch,rgba(255,255,255,.15))' : 'none',
    cursor: 'pointer', fontSize: 13, fontWeight: 600,
    background: variant === 'action' ? 'var(--sv-action,#3b82f6)' : variant === 'red' ? '#ef4444' : 'none',
    color: variant === 'ghost' ? 'var(--sv-text-dim,#94a3b8)' : '#fff',
  }),
  label:  { fontSize: 11, color: 'var(--sv-text-dim,#94a3b8)', marginBottom: 5, display: 'block' as const, textTransform: 'uppercase' as const, letterSpacing: .5, fontWeight: 600 },
  th:     { padding: '8px 14px', fontSize: 11, fontWeight: 700, color: 'var(--sv-text-dim,#94a3b8)', textTransform: 'uppercase' as const, letterSpacing: .5, borderBottom: '1px solid var(--sv-etch,rgba(255,255,255,.1))', textAlign: 'left' as const, background: 'var(--sv-bg-2,#334155)', whiteSpace: 'nowrap' as const },
  td:     { padding: '10px 14px', fontSize: 13, borderBottom: '1px solid var(--sv-etch,rgba(255,255,255,.07))' },
};

// ── Delete modal ──────────────────────────────────────────────────────────────
function DeleteBusinessModal({ biz, onClose, onDeleted }: { biz: Business; onClose: () => void; onDeleted: () => void }) {
  const [step, setStep] = useState(1);
  const [token, setToken] = useState('');
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState('');

  const doDelete = async () => {
    if (token !== 'DELETE BUSINESS') { setErr('Type exactly: DELETE BUSINESS'); return; }
    setWorking(true);
    const res = await fetch(`/api/admin/businesses/${biz.business_id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmToken: token }),
    });
    const d = await res.json();
    if (d.success) { onDeleted(); onClose(); }
    else { setErr(d.error ?? 'Failed'); setWorking(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--sv-bg-1,#1e293b)', border: '1px solid var(--sv-etch,rgba(255,255,255,.1))', borderRadius: 12, padding: 28, maxWidth: 460, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 18, color: '#ef4444' }}>⚠️ Delete Business</h2>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--sv-text-dim,#94a3b8)', lineHeight: 1.6 }}>
          You are about to delete <strong style={{ color: '#fff' }}>{biz.name}</strong>.<br />
          This will soft-delete the business record. All associated data stays in the database.
        </p>

        {step === 1 && (
          <>
            <p style={{ fontSize: 13, color: '#fbbf24', margin: '0 0 16px' }}>Are you absolutely sure you want to proceed?</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={S.btn('ghost')}>Cancel</button>
              <button onClick={() => setStep(2)} style={S.btn('red')}>Yes, continue →</button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <p style={{ fontSize: 13, color: '#fbbf24', margin: '0 0 16px' }}>This is irreversible. All users of this business will lose access. Are you certain?</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={S.btn('ghost')}>Cancel</button>
              <button onClick={() => setStep(3)} style={S.btn('red')}>Yes, I understand →</button>
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <p style={{ fontSize: 13, color: '#fbbf24', margin: '0 0 10px' }}>
              Final confirmation. Type <code style={{ background: 'rgba(239,68,68,.2)', padding: '1px 6px', borderRadius: 4, color: '#fca5a5' }}>DELETE BUSINESS</code> to confirm.
            </p>
            <input
              value={token} onChange={e => setToken(e.target.value)}
              placeholder="DELETE BUSINESS"
              style={{ ...S.input, borderColor: token === 'DELETE BUSINESS' ? '#22c55e' : 'var(--sv-etch)', marginBottom: 10 }}
            />
            {err && <p style={{ color: '#ef4444', fontSize: 12, margin: '0 0 10px' }}>{err}</p>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={S.btn('ghost')}>Cancel</button>
              <button onClick={doDelete} disabled={working || token !== 'DELETE BUSINESS'} style={{ ...S.btn('red'), opacity: token !== 'DELETE BUSINESS' ? .4 : 1 }}>
                {working ? 'Deleting…' : 'Delete Business'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Business Settings Modal ───────────────────────────────────────────────────
function BusinessSettingsModal({ biz, onClose, onSaved }: { biz: Business; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: biz.name,
    has_foresight: !!biz.has_foresight, has_ims: !!biz.has_ims, has_pos: !!biz.has_pos,
    max_locations: biz.max_locations !== null && biz.max_locations !== undefined ? String(biz.max_locations) : '',
    max_users: biz.max_users !== null && biz.max_users !== undefined ? String(biz.max_users) : '',
    cost_per_location: biz.cost_per_location !== null && biz.cost_per_location !== undefined ? String(biz.cost_per_location) : '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setSaving(true); setErr('');
    const res = await fetch(`/api/admin/businesses/${biz.business_id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        has_foresight: form.has_foresight, has_ims: form.has_ims, has_pos: form.has_pos,
        max_locations: form.max_locations.trim() === '' ? null : Number(form.max_locations),
        max_users: form.max_users.trim() === '' ? null : Number(form.max_users),
        cost_per_location: form.cost_per_location.trim() === '' ? null : Number(form.cost_per_location),
      }),
    });
    const d = await res.json();
    if (d.success) { onSaved(); onClose(); }
    else { setErr(d.error ?? 'Failed'); setSaving(false); }
  };

  const toggle = (field: 'has_foresight' | 'has_ims' | 'has_pos') =>
    setForm(p => ({ ...p, [field]: !p[field] }));

  const AccessCheck = ({ label, field }: { label: string; field: 'has_foresight' | 'has_ims' | 'has_pos' }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 0', borderBottom: '1px solid var(--sv-etch,rgba(255,255,255,.07))' }}>
      <div
        onClick={() => toggle(field)}
        style={{ width: 20, height: 20, borderRadius: 5, border: '2px solid', borderColor: form[field] ? 'var(--sv-action,#3b82f6)' : 'var(--sv-etch,rgba(255,255,255,.3))', background: form[field] ? 'var(--sv-action,#3b82f6)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}
      >
        {form[field] && <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sv-text-main,#e2e8f0)' }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--sv-text-dim,#94a3b8)' }}>{form[field] ? 'Enabled' : 'Disabled'}</div>
      </div>
    </label>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--sv-bg-1,#1e293b)', border: '1px solid var(--sv-etch,rgba(255,255,255,.1))', borderRadius: 12, padding: 28, maxWidth: 440, width: '100%' }}>
        <h2 style={{ margin: '0 0 18px', fontSize: 17, color: 'var(--sv-text-main,#e2e8f0)' }}>⚙️ Business Settings — {biz.name}</h2>

        <label style={S.label}>Business Name</label>
        <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} style={{ ...S.input, marginBottom: 18 }} />

        <label style={S.label}>Module Access</label>
        <AccessCheck label="Foresight (BI Dashboard)" field="has_foresight" />
        <AccessCheck label="IMS (Inventory Management)" field="has_ims" />
        <AccessCheck label="POS (Point of Sale)" field="has_pos" />

        <div style={{ height: 1, background: 'var(--sv-etch,rgba(255,255,255,.1))', margin: '18px 0' }} />
        <label style={S.label}>Plan Limits & Billing</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 4 }}>
          <div>
            <label style={{ ...S.label, marginBottom: 4 }}>Max Locations</label>
            <input
              type="number" min={1} value={form.max_locations}
              onChange={e => setForm(p => ({ ...p, max_locations: e.target.value }))}
              placeholder="Unlimited"
              style={S.input}
            />
          </div>
          <div>
            <label style={{ ...S.label, marginBottom: 4 }}>Max Users</label>
            <input
              type="number" min={1} value={form.max_users}
              onChange={e => setForm(p => ({ ...p, max_users: e.target.value }))}
              placeholder="Unlimited"
              style={S.input}
            />
          </div>
          <div>
            <label style={{ ...S.label, marginBottom: 4 }}>Cost / Location ($/mo)</label>
            <input
              type="number" min={0} step={0.01} value={form.cost_per_location}
              onChange={e => setForm(p => ({ ...p, cost_per_location: e.target.value }))}
              placeholder="0.00"
              style={S.input}
            />
          </div>
        </div>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--sv-text-dim,#94a3b8)' }}>
          Leave blank for unlimited. Limits are enforced when creating new locations or inviting users.
        </p>

        {err && <p style={{ color: '#ef4444', fontSize: 12, margin: '12px 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={S.btn('ghost')}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ ...S.btn('action'), opacity: saving ? .6 : 1 }}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Onboard Business Modal ────────────────────────────────────────────────────
function OnboardBusinessModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [form, setForm] = useState({
    name: '', hasForesight: true, hasIms: true, hasPos: true,
    imsDbName: '', imsDbEdited: false,
    ownerEmail: '', ownerPassword: '', ownerName: '',
  });
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState('');
  const [steps, setSteps] = useState<string[]>([]);

  // Auto-derive the IMS schema name from the business name until the user edits it.
  const derived = form.name ? `readyedu_${form.name.replace(/[^a-zA-Z0-9]/g, '')}IMS` : '';
  const imsDbValue = form.imsDbEdited ? form.imsDbName : derived;

  const set = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));
  const toggle = (k: 'hasForesight' | 'hasIms' | 'hasPos') => setForm(p => ({ ...p, [k]: !p[k] }));

  const submit = async () => {
    setErr(''); setSteps([]);
    if (!form.name.trim()) { setErr('Business name is required.'); return; }
    if (form.ownerEmail && !form.ownerPassword) { setErr('Owner password is required when an owner email is given.'); return; }
    setWorking(true);
    try {
      const r = await fetch('/api/admin/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          hasForesight: form.hasForesight, hasIms: form.hasIms, hasPos: form.hasPos,
          imsDbName: form.hasIms ? (imsDbValue || undefined) : undefined,
          ownerEmail: form.ownerEmail.trim() || undefined,
          ownerPassword: form.ownerPassword || undefined,
          ownerName: form.ownerName.trim() || undefined,
        }),
      });
      const d = await r.json();
      if (d.success) {
        setSteps(d.steps ?? []);
        onDone(`✓ Onboarded "${form.name.trim()}"${d.imsDbName ? ` · IMS: ${d.imsDbName}` : ''}`);
        setTimeout(onClose, 1200);
      } else {
        setSteps(d.steps ?? []);
        setErr(d.error ?? 'Onboarding failed.');
        setWorking(false);
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Network error.');
      setWorking(false);
    }
  };

  const Toggle = ({ label, field }: { label: string; field: 'hasForesight' | 'hasIms' | 'hasPos' }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 0' }}>
      <div onClick={() => toggle(field)} style={{ width: 20, height: 20, borderRadius: 5, border: '2px solid', borderColor: form[field] ? 'var(--sv-action,#3b82f6)' : 'var(--sv-etch,rgba(255,255,255,.3))', background: form[field] ? 'var(--sv-action,#3b82f6)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {form[field] && <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </div>
      <span style={{ fontSize: 13, color: 'var(--sv-text-main,#e2e8f0)' }}>{label}</span>
    </label>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--sv-bg-1,#1e293b)', border: '1px solid var(--sv-etch,rgba(255,255,255,.1))', borderRadius: 12, padding: 28, maxWidth: 500, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18, color: 'var(--sv-text-main,#e2e8f0)' }}>🚀 Onboard New Business</h2>
        <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--sv-text-dim,#94a3b8)', lineHeight: 1.6 }}>
          Creates the business, provisions its dedicated IMS database schema (with integrity triggers), and optionally seeds an owner account.
        </p>

        <label style={S.label}>Business Name *</label>
        <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Acme Trading Co" style={{ ...S.input, marginBottom: 16 }} />

        <label style={S.label}>Module Access</label>
        <div style={{ marginBottom: 12 }}>
          <Toggle label="Foresight (BI Dashboard)" field="hasForesight" />
          <Toggle label="IMS (Inventory Management)" field="hasIms" />
          <Toggle label="POS (Point of Sale)" field="hasPos" />
        </div>

        {form.hasIms && (
          <div style={{ marginBottom: 16 }}>
            <label style={S.label}>IMS Schema Name</label>
            <input
              value={imsDbValue}
              onChange={e => setForm(p => ({ ...p, imsDbName: e.target.value, imsDbEdited: true }))}
              style={{ ...S.input, fontFamily: 'monospace', fontSize: 12 }}
            />
            <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--sv-text-dim,#94a3b8)' }}>
              A new schema created on the shared MySQL server. Auto-derived from the name; edit if needed.
            </p>
          </div>
        )}

        <details style={{ marginBottom: 16 }}>
          <summary style={{ ...S.label, cursor: 'pointer', marginBottom: 10 }}>Owner Account (optional)</summary>
          <label style={S.label}>Owner Email</label>
          <input type="email" value={form.ownerEmail} onChange={e => set('ownerEmail', e.target.value)} style={{ ...S.input, marginBottom: 10 }} />
          <label style={S.label}>Owner Password</label>
          <input type="password" value={form.ownerPassword} onChange={e => set('ownerPassword', e.target.value)} style={{ ...S.input, marginBottom: 10 }} />
          <label style={S.label}>Owner Name</label>
          <input value={form.ownerName} onChange={e => set('ownerName', e.target.value)} style={{ ...S.input }} />
          <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--sv-text-dim,#94a3b8)' }}>Creates an <strong>Admin</strong>-tier user bound to this business.</p>
        </details>

        {steps.length > 0 && (
          <div style={{ marginBottom: 14, padding: '10px 12px', background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.25)', borderRadius: 8 }}>
            {steps.map((s, i) => <div key={i} style={{ fontSize: 12, color: '#93c5fd', padding: '2px 0' }}>✓ {s}</div>)}
          </div>
        )}
        {err && <p style={{ color: '#ef4444', fontSize: 12, margin: '0 0 12px' }}>{err}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={working} style={S.btn('ghost')}>Cancel</button>
          <button onClick={submit} disabled={working || !form.name.trim()} style={{ ...S.btn('action'), opacity: working || !form.name.trim() ? .5 : 1 }}>
            {working ? 'Onboarding…' : 'Onboard Business'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Businesses View ───────────────────────────────────────────────────────────
function BusinessesView() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletingBiz, setDeletingBiz] = useState<Business | null>(null);
  const [settingsBiz, setSettingsBiz] = useState<Business | null>(null);
  const [onboarding, setOnboarding]   = useState(false);
  const [flash, setFlash]           = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetch('/api/admin/businesses').then(r => r.json()).catch(() => ({ businesses: [] }));
    setBusinesses(d.businesses ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const showFlash = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(''), 3000); };
  const visible = showDeleted ? businesses : businesses.filter(b => !b.deleted_at);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--sv-text-main,#e2e8f0)' }}>🏢 Businesses</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--sv-text-dim,#94a3b8)' }}>{visible.length} business{visible.length !== 1 ? 'es' : ''} registered</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--sv-text-dim,#94a3b8)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showDeleted} onChange={e => setShowDeleted(e.target.checked)} />
            Show deleted
          </label>
          <button onClick={() => setOnboarding(true)} style={S.btn('action')}>🚀 Onboard Business</button>
        </div>
      </div>

      {flash && (
        <div style={{ padding: '10px 14px', background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.3)', borderRadius: 8, marginBottom: 14, fontSize: 13, color: '#86efac' }}>{flash}</div>
      )}

      <div style={{ background: 'var(--sv-bg-1,#1e293b)', border: '1px solid var(--sv-etch,rgba(255,255,255,.1))', borderRadius: 10, overflow: 'hidden' }}>
        {loading ? (
          <p style={{ padding: 24, color: 'var(--sv-text-dim,#94a3b8)', margin: 0 }}>Loading…</p>
        ) : visible.length === 0 ? (
          <p style={{ padding: 24, color: 'var(--sv-text-dim,#94a3b8)', margin: 0 }}>No businesses.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Name','Foresight','IMS','POS','Created','Status','Actions'].map(h => <th key={h} style={S.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.map(b => (
                  <tr key={b.business_id} style={{ opacity: b.deleted_at ? .45 : 1 }}>
                    <td style={S.td}>
                      <div style={{ fontWeight: 600, color: 'var(--sv-text-main,#e2e8f0)' }}>{b.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--sv-text-dim,#94a3b8)', fontFamily: 'monospace', marginTop: 2 }}>{b.business_id.slice(0, 24)}…</div>
                    </td>
                    {(['has_foresight','has_ims','has_pos'] as const).map(f => (
                      <td key={f} style={{ ...S.td, textAlign: 'center' }}>
                        <span style={{ fontSize: 16 }}>{b[f] ? '✅' : '⬜'}</span>
                      </td>
                    ))}
                    <td style={{ ...S.td, color: 'var(--sv-text-dim,#94a3b8)' }}>{b.created_at?.slice(0, 10)}</td>
                    <td style={S.td}>
                      {b.deleted_at
                        ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'rgba(239,68,68,.15)', color: '#fca5a5' }}>Deleted</span>
                        : <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'rgba(34,197,94,.12)', color: '#86efac' }}>Active</span>
                      }
                    </td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setSettingsBiz(b)} style={{ ...S.btn('ghost'), fontSize: 12, padding: '4px 10px' }}>⚙️ Settings</button>
                        {!b.deleted_at && (
                          <button onClick={() => setDeletingBiz(b)} style={{ ...S.btn('red'), fontSize: 12, padding: '4px 10px' }}>🗑 Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deletingBiz && (
        <DeleteBusinessModal
          biz={deletingBiz}
          onClose={() => setDeletingBiz(null)}
          onDeleted={() => { load(); showFlash(`✓ ${deletingBiz.name} deleted.`); }}
        />
      )}
      {settingsBiz && (
        <BusinessSettingsModal
          biz={settingsBiz}
          onClose={() => setSettingsBiz(null)}
          onSaved={() => { load(); showFlash('✓ Settings saved.'); }}
        />
      )}
      {onboarding && (
        <OnboardBusinessModal
          onClose={() => setOnboarding(false)}
          onDone={(msg) => { load(); showFlash(msg); }}
        />
      )}
    </div>
  );
}

// ── Users View ─────────────────────────────────────────────────────────────────
function UsersView() {
  const [users, setUsers]         = useState<User[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', password: '', name: '', tier: 'SuperAdmin' });
  const [editingId, setEditingId]   = useState<number | null>(null);
  const [editForm, setEditForm]     = useState({ tier: '', name: '' });
  const [flash, setFlash]           = useState('');
  const [err, setErr]               = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetch('/api/admin/users').then(r => r.json()).catch(() => ({ users: [] }));
    setUsers(d.users ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const showFlash = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(''), 3500); };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    const r = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(createForm) });
    const d = await r.json();
    if (r.ok) { showFlash('✓ User created.'); setShowCreate(false); setCreateForm({ email: '', password: '', name: '', tier: 'SuperAdmin' }); load(); }
    else setErr(d.error ?? 'Failed');
  };

  const saveEdit = async (id: number) => {
    const r = await fetch(`/api/admin/users?userId=${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm) });
    if (r.ok) { showFlash('✓ User updated.'); setEditingId(null); load(); }
  };

  const deleteUser = async (id: number, email: string) => {
    if (!confirm(`Delete user ${email}?`)) return;
    await fetch(`/api/admin/users?userId=${id}`, { method: 'DELETE' });
    showFlash('✓ User deleted.'); load();
  };

  const TIER_COLORS: Record<string, string> = {
    SuperAdmin: '#e05252', Admin: '#3eb8b0', StandardUser: '#4a9ede',
    Advisor: '#f59e0b', PosManager: '#c084fc', PosUser: '#6dba8a',
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--sv-text-main,#e2e8f0)' }}>👥 Users</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--sv-text-dim,#94a3b8)' }}>{users.length} registered user{users.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowCreate(true)} style={S.btn('action')}>+ Add User</button>
      </div>

      {flash && <div style={{ padding: '10px 14px', background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.3)', borderRadius: 8, marginBottom: 14, fontSize: 13, color: '#86efac' }}>{flash}</div>}

      {showCreate && (
        <div style={{ ...S.card, marginBottom: 20, maxWidth: 500 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, color: 'var(--sv-text-main,#e2e8f0)' }}>Create User</h3>
          <form onSubmit={createUser}>
            {[
              { label: 'Email', field: 'email', type: 'email' },
              { label: 'Password', field: 'password', type: 'password' },
              { label: 'Full Name', field: 'name', type: 'text' },
            ].map(f => (
              <div key={f.field} style={{ marginBottom: 12 }}>
                <label style={S.label}>{f.label}</label>
                <input required type={f.type} value={(createForm as any)[f.field]} onChange={e => setCreateForm(p => ({ ...p, [f.field]: e.target.value }))} style={S.input} />
              </div>
            ))}
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Tier</label>
              <select value={createForm.tier} onChange={e => setCreateForm(p => ({ ...p, tier: e.target.value }))} style={S.input}>
                {['SuperAdmin','Admin','StandardUser','Advisor','PosManager','PosUser'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {err && <p style={{ color: '#ef4444', fontSize: 12, marginBottom: 10 }}>{err}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => { setShowCreate(false); setErr(''); }} style={S.btn('ghost')}>Cancel</button>
              <button type="submit" style={S.btn('action')}>Create</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ background: 'var(--sv-bg-1,#1e293b)', border: '1px solid var(--sv-etch,rgba(255,255,255,.1))', borderRadius: 10, overflow: 'hidden' }}>
        {loading ? (
          <p style={{ padding: 24, color: 'var(--sv-text-dim,#94a3b8)', margin: 0 }}>Loading…</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{['Name','Email','Tier','Business','Actions'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={S.td}>
                      {editingId === u.id
                        ? <input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} style={{ ...S.input, width: 140 }} />
                        : <span style={{ color: 'var(--sv-text-main,#e2e8f0)', fontWeight: 500 }}>{u.name || '—'}</span>}
                    </td>
                    <td style={{ ...S.td, color: 'var(--sv-text-dim,#94a3b8)' }}>{u.email}</td>
                    <td style={S.td}>
                      {editingId === u.id
                        ? <select value={editForm.tier} onChange={e => setEditForm(p => ({ ...p, tier: e.target.value }))} style={{ ...S.input, width: 140 }}>
                            {['SuperAdmin','Admin','StandardUser','Advisor','PosManager','PosUser'].map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        : <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, fontWeight: 700, background: `${TIER_COLORS[u.tier] ?? '#64748b'}22`, color: TIER_COLORS[u.tier] ?? '#94a3b8' }}>{u.tier}</span>}
                    </td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--sv-text-dim,#94a3b8)', fontFamily: 'monospace' }}>{u.business_id ? u.business_id.slice(0, 18) + '…' : '—'}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {editingId === u.id ? (
                          <>
                            <button onClick={() => saveEdit(u.id)} style={{ ...S.btn('action'), fontSize: 12, padding: '4px 10px' }}>Save</button>
                            <button onClick={() => setEditingId(null)} style={{ ...S.btn('ghost'), fontSize: 12, padding: '4px 10px' }}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => { setEditingId(u.id); setEditForm({ tier: u.tier, name: u.name ?? '' }); }} style={{ ...S.btn('ghost'), fontSize: 12, padding: '4px 10px' }}>Edit</button>
                            <button onClick={() => deleteUser(u.id, u.email)} style={{ ...S.btn('red'), fontSize: 12, padding: '4px 10px' }}>Delete</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main admin page ───────────────────────────────────────────────────────────
export default function AdminPage() {
  const router = useRouter();
  const [view, setView]       = useState<View>('businesses');
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => {
        if (d.user?.tier === 'SuperAdmin') setChecked(true);
        else router.replace('/dashboard');
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  if (!checked) return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 14 }}>
      Checking access…
    </div>
  );

  return (
    <div style={S.page}>
      {/* Topbar */}
      <div style={S.topbar}>
        <svg width="20" height="20" viewBox="0 0 28 28" fill="none"><path d="M14 2L24 7.5V20.5L14 26L4 20.5V7.5L14 2Z" fill="#1ea8c2" fillOpacity=".15" stroke="#1ea8c2" strokeWidth="1.5"/><path d="M16.5 8H12L10.5 14H13.5L11.5 20L19 12.5H15L16.5 8Z" fill="#1ea8c2"/></svg>
        <span style={{ color: '#1ea8c2', fontWeight: 700, fontSize: 15, letterSpacing: -.3 }}>Solvantis</span>
        <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: -.3, color: '#e2e8f0', marginLeft: 4 }}>Admin</span>
        <span style={{ color: 'rgba(255,255,255,.2)', margin: '0 6px', fontSize: 12 }}>|</span>
        {[{ label: 'Foresight', href: '/dashboard' }, { label: 'IMS', href: '/ims' }, { label: 'POS', href: '/pos' }].map(item => (
          <a key={item.href} href={item.href} style={{ fontSize: 13, color: 'rgba(255,255,255,.45)', textDecoration: 'none', fontWeight: 500 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,.85)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,.45)')}
          >{item.label}</a>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'rgba(224,82,82,.2)', color: '#fca5a5', fontWeight: 700 }}>SUPER ADMIN</span>
      </div>

      <div style={S.body}>
        {/* Sidebar */}
        <div style={S.sidebar}>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--sv-text-dim,#64748b)', textTransform: 'uppercase', letterSpacing: .7, padding: '4px 12px', margin: '4px 0 8px' }}>Admin</p>
          {([
            { id: 'businesses', label: '🏢 Businesses' },
            { id: 'users',      label: '👥 Users' },
          ] as { id: View; label: string }[]).map(item => (
            <button key={item.id} onClick={() => setView(item.id)} style={S.navBtn(view === item.id)}>{item.label}</button>
          ))}
        </div>

        {/* Main */}
        <div style={S.main}>
          {view === 'businesses' && <BusinessesView />}
          {view === 'users'      && <UsersView />}
        </div>
      </div>
    </div>
  );
}
