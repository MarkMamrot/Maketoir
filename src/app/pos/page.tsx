'use client';
import { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue } from 'react';
import type { DeviceConfig, PosSession, CachedProduct, CartItem, PaymentEntry, ParkedSale, CompletedSale } from './_types';
import {
  loadDeviceConfig, saveDeviceConfig, clearDeviceConfig,
  loadProductsCache, saveProductsCache,
  loadCurrentCart, saveCurrentCart,
  loadParkedSales, saveParkedSales,
  addToOfflineQueue, drainOfflineQueue, loadOfflineQueue, removeFromOfflineQueue,
  loadFailedQueue, retryFailedQueue, removeFromFailedQueue,
  saveLocalSession, loadLocalSession, clearLocalSession,
  newLocalId,
  isProductsCacheStale, PRODUCTS_CACHE_TTL_MS,
} from './_store';

// â”€â”€â”€ Utilities â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function fmt(n: number) { return n.toFixed(2); }
function calcLineTotal(item: CartItem): number {
  const base = item.qty * item.unit_price;
  return Math.max(0, base - item.discount_amount);
}
function calcTotals(items: CartItem[]) {
  const subtotal       = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const discount_total = items.reduce((s, i) => s + i.discount_amount,    0);
  const total          = Math.max(0, subtotal - discount_total);
  const tax_total      = total * 0.1 / 1.1; // GST inclusive
  return { subtotal, discount_total, total, tax_total };
}

// â”€â”€â”€ DeviceSetup Screen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function DeviceSetup({ onSetup }: { onSetup: (cfg: DeviceConfig) => void }) {
  const [locations, setLocations]   = useState<{ id: number; name: string }[]>([]);
  const [registers, setRegisters]   = useState<{ id: number; name: string; default_float: number }[]>([]);
  const [locationId, setLocationId] = useState('');
  const [registerId, setRegisterId] = useState('');
  const [pin,    setPin]    = useState('');
  const [supPin, setSupPin] = useState('');
  const [step,    setStep]    = useState<'location' | 'register'>('location');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [verifiedLocation, setVerifiedLocation] = useState<{ name: string } | null>(null);
  const [locLoading, setLocLoading] = useState(true);
  const [locError,   setLocError]   = useState('');

  const loadLocations = () => {
    setLocLoading(true); setLocError('');
    fetch('/api/pos/locations')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { setLocations(d.locations ?? []); if (!d.locations?.length) setLocError('No active locations found. Add one in IMS â†’ Locations.'); })
      .catch(e => setLocError(e.message || 'Failed to load locations.'))
      .finally(() => setLocLoading(false));
  };

  useEffect(() => { loadLocations(); }, []);

  async function handleVerifyLocation() {
    if (!locationId) { setError('Select a location.'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/pos/setup/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: Number(locationId), pin: pin.trim() }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error ?? 'PIN verification failed.'); return; }
      setVerifiedLocation({ name: data.location_name });
      const regRes  = await fetch(`/api/pos/registers?location_id=${locationId}`);
      const regData = await regRes.json();
      const activeRegs = (regData.registers ?? []).filter((r: any) => r.is_active);
      setRegisters(activeRegs);
      if (activeRegs.length === 1) setRegisterId(String(activeRegs[0].id));
      setStep('register');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup() {
    if (!registerId) { setError('Select a register.'); return; }
    setLoading(true); setError('');
    try {
      const reg = registers.find(r => r.id === Number(registerId))!;
      const cfg: DeviceConfig = {
        location_id:    Number(locationId),
        location_name:  verifiedLocation!.name,
        register_id:    reg.id,
        register_name:  reg.name,
        supervisor_pin: supPin ? await hashPin(supPin) : undefined,
      };
      saveDeviceConfig(cfg);
      onSetup(cfg);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function hashPin(pin: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sv-bg-0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', padding: '2.5rem 2rem', borderRadius: 12, width: 380, boxShadow: '0 8px 40px rgba(0,0,0,.4)' }}>
        <h1 style={{ margin: '0 0 .5rem', fontSize: '1.4rem', color: 'var(--sv-text-strong)' }}>POS â€” Device Setup</h1>
        <p style={{ color: 'var(--sv-text-dim)', marginBottom: '1.5rem', fontSize: '.9rem' }}>Configure this device once. Contact your manager for the Location PIN.</p>

        {step === 'location' ? (
          <>
            <label style={labelStyle}>Branch / Location</label>
            {locLoading ? (
              <p style={{ color: 'var(--sv-text-dim)', fontSize: '.82rem', padding: '.5rem', border: '1px solid var(--sv-etch)', borderRadius: 6 }}>Loading locationsâ€¦</p>
            ) : locError ? (
              <div>
                <p style={{ color: 'var(--sv-red)', fontSize: '.82rem', marginBottom: '.4rem' }}>{locError}</p>
                <button onClick={loadLocations} style={{ fontSize: '.8rem', padding: '.3rem .75rem', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-2)', color: 'var(--sv-text-main)', cursor: 'pointer' }}>Retry</button>
              </div>
            ) : (
              <select value={locationId} onChange={e => { setLocationId(e.target.value); setError(''); }} style={inputStyle}>
                <option value=''>â€” select location â€”</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
            <label style={labelStyle}>Location PIN</label>
            <input type='password' maxLength={20} placeholder='PIN set in IMS Locations (blank if none)' value={pin} onChange={e => setPin(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleVerifyLocation()} style={inputStyle} />
            {error && <p style={{ color: 'var(--sv-red)', fontSize: '.85rem', marginBottom: '1rem' }}>{error}</p>}
            <button onClick={handleVerifyLocation} disabled={loading || !locationId || locLoading} style={primaryBtn}>
              {loading ? 'Verifyingâ€¦' : 'Next â†’'}
            </button>
          </>
        ) : (
          <>
            <p style={{ color: 'var(--sv-action)', fontWeight: 600, marginBottom: '1.25rem' }}>{verifiedLocation?.name}</p>
            <label style={labelStyle}>Register / Till</label>
            {registers.length > 0 ? (
              <select value={registerId} onChange={e => { setRegisterId(e.target.value); setError(''); }} style={inputStyle}>
                <option value=''>â€” select register â€”</option>
                {registers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            ) : (
              <p style={{ color: 'var(--sv-text-dim)', fontSize: '.82rem', padding: '.5rem', border: '1px solid var(--sv-etch)', borderRadius: 6 }}>No registers found for this location. Ask your manager to add one in IMS.</p>
            )}
            <label style={labelStyle}>Supervisor Override PIN (optional)</label>
            <input type='password' maxLength={8} placeholder='4-8 digit PIN for supervisor overrides' value={supPin} onChange={e => setSupPin(e.target.value)} style={inputStyle} />
            {error && <p style={{ color: 'var(--sv-red)', fontSize: '.85rem', marginBottom: '1rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <button onClick={() => { setStep('location'); setError(''); }} style={{ ...primaryBtn, flex: '0 0 auto', background: 'var(--sv-bg-2)' }}>â† Back</button>
              <button onClick={handleSetup} disabled={loading || !registerId} style={{ ...primaryBtn, flex: 1 }}>
                {loading ? 'Savingâ€¦' : 'Set Up Device'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// â”€â”€â”€ Register Gate â”€ shown when a stale open session is detected on login â”€â”€â”€â”€â”€

function RegisterGate({ session, deviceConfig, staleSession, onContinue, onGoToEod }: {
  session:      PosSession;
  deviceConfig: DeviceConfig;
  staleSession: any;
  onContinue:   () => void;
  onGoToEod:    () => void;
}) {
  const openedAt   = staleSession?.opened_at
    ? new Date(staleSession.opened_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })
    : 'unknown time';
  const openedDate = staleSession?.session_date ?? '';
  // Today in the business timezone (session_date is stored as a local date string).
  const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const isPriorDay = !!openedDate && String(openedDate).slice(0, 10) !== todayStr;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sv-bg-0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid rgba(251,191,36,.35)', padding: '2rem', borderRadius: 12, width: 400, boxShadow: '0 8px 40px rgba(0,0,0,.4)' }}>
        <div style={{ fontSize: '2rem', marginBottom: '.5rem', textAlign: 'center' }}>âš ï¸</div>
        <h2 style={{ margin: '0 0 .75rem', textAlign: 'center', color: 'var(--sv-text-strong)' }}>Register Left Open</h2>
        <p style={{ color: 'var(--sv-text-main)', marginBottom: '.5rem', textAlign: 'center', lineHeight: 1.5 }}>
          <strong>{deviceConfig.register_name}</strong> was opened on <strong>{openedDate}</strong> at <strong>{openedAt}</strong> and was not closed.
        </p>
        {isPriorDay ? (
          <p style={{ color: 'var(--sv-red)', marginBottom: '1.5rem', textAlign: 'center', fontSize: '.88rem', lineHeight: 1.5 }}>
            This session is from a <strong>previous day</strong>. To keep your end-of-day takings accurate, close it and open a fresh session for today. Only continue if you intend to keep recording against {openedDate}.
          </p>
        ) : (
          <p style={{ color: 'var(--sv-text-dim)', marginBottom: '1.5rem', textAlign: 'center', fontSize: '.88rem' }}>
            Continue that session or close it first.
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          <button
            onClick={onGoToEod}
            style={{ ...primaryBtn, width: '100%', ...(isPriorDay ? {} : { background: 'var(--sv-bg-2)', color: 'var(--sv-text-main)', border: '1px solid var(--sv-etch)' }) }}
          >
            Close Register (Enter Counts)
          </button>
          <button
            onClick={onContinue}
            style={{ ...primaryBtn, width: '100%', ...(isPriorDay ? { background: 'var(--sv-bg-2)', color: 'var(--sv-text-main)', border: '1px solid var(--sv-etch)' } : {}) }}
          >
            Continue Session
          </button>
        </div>
        <p style={{ color: 'var(--sv-text-dim)', fontSize: '.78rem', marginTop: '1rem', textAlign: 'center' }}>
          Closing will take you to the End-of-Day screen so you can enter your counts before the session is finalised.
        </p>
        <p style={{ color: 'var(--sv-text-dim)', fontSize: '.78rem', marginTop: '.5rem', textAlign: 'center' }}>{session.full_name} Â· {deviceConfig.location_name}</p>
      </div>
    </div>
  );
}

// â”€â”€â”€ Login Screen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function LoginScreen({ deviceConfig, onLogin, onDeviceSetup }: {
  deviceConfig:  DeviceConfig;
  onLogin:       (session: PosSession, products: CachedProduct[], methods: string[]) => void;
  onDeviceSetup: () => void;
}) {
  type StaffUser = { id: number; name: string; has_pos_pin: boolean };
  const [staff,        setStaff]        = useState<StaffUser[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [selected,     setSelected]     = useState<StaffUser | null>(null);
  const [pin,          setPin]          = useState('');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  // Admin fallback â€” email + password
  const [adminMode,    setAdminMode]    = useState(false);
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const pinRef  = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/pos/auth/staff?location_id=${deviceConfig.location_id}`)
      .then(r => r.json())
      .then(d => setStaff(d.users ?? []))
      .catch(() => {})
      .finally(() => setStaffLoading(false));
  }, []);

  const initials = (name: string) =>
    name.split(' ').map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 2) || '?';

  async function finishLogin(session: PosSession) {
    const [prodRes, methodRes] = await Promise.all([
      fetch(`/api/pos/products?location_id=${deviceConfig.location_id}`),
      fetch('/api/pos/settings/payment-methods'),
    ]);
    const prodData   = await prodRes.json().catch(() => ({ products: [] }));
    const methodData = await methodRes.json().catch(() => ({ methods: ['Cash', 'Card', 'EFT'] }));
    saveProductsCache(prodData.products ?? []);
    saveLocalSession(session);
    onLogin(session, prodData.products ?? [], methodData.methods ?? ['Cash', 'Card', 'EFT']);
  }

  async function handlePinLogin() {
    if (!selected) return;
    if (!pin) { setError('Enter your PIN.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/pos/auth/pin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: selected.id, pin, location_id: deviceConfig.location_id }),
      });
      const data = await res.json();
      if (!res.ok || !data.session) { setError(data.error ?? 'Incorrect PIN.'); return; }
      await finishLogin({
        ...data.session,
        register_id:   deviceConfig.register_id   ?? null,
        register_name: deviceConfig.register_name ?? null,
      });
    } catch (e: any) {
      setError(e.message || 'Network error.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminLogin() {
    if (!email || !password) { setError('Enter email and password.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setError(data.error ?? 'Login failed.'); return; }
      const meRes  = await fetch(`/api/pos/auth/me?location_id=${deviceConfig.location_id}`);
      const meData = await meRes.json();
      if (!meData.session) { setError('Could not create POS session.'); return; }
      await finishLogin({
        ...meData.session,
        register_id:   deviceConfig.register_id   ?? null,
        register_name: deviceConfig.register_name ?? null,
      });
    } catch (e: any) {
      setError(e.message || 'Network error.');
    } finally {
      setLoading(false);
    }
  }

  const header = (
    <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
      <div style={{ fontSize: '2rem', marginBottom: '.25rem' }}>ðŸ›’</div>
      <h1 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--sv-text-strong)' }}>POS Login</h1>
      <p style={{ margin: '.25rem 0 0', color: 'var(--sv-action)', fontSize: '.95rem', fontWeight: 600 }}>{deviceConfig.location_name}</p>
      {deviceConfig.register_name && <p style={{ margin: '.1rem 0 0', color: 'var(--sv-text-dim)', fontSize: '.82rem' }}>{deviceConfig.register_name}</p>}
    </div>
  );

  const footer = (
    <div style={{ marginTop: '1.5rem', paddingTop: '.75rem', borderTop: '1px solid var(--sv-etch)', textAlign: 'center', fontSize: '.73rem', color: 'var(--sv-text-dim)' }}>
      Device: {deviceConfig.location_name}{deviceConfig.register_name ? ` â€” ${deviceConfig.register_name}` : ''}
      <button onClick={onDeviceSetup} style={{ marginLeft: '.5rem', background: 'none', border: 'none', color: 'var(--sv-action)', cursor: 'pointer', fontSize: '.73rem', padding: 0 }}>Change</button>
    </div>
  );

  const wrap = (children: React.ReactNode, wide = false) => (
    <div style={{ minHeight: '100vh', background: 'var(--sv-bg-0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', padding: '2.5rem 2rem', borderRadius: 12, width: wide ? 520 : 360, boxShadow: '0 8px 40px rgba(0,0,0,.4)' }}>
        {children}
      </div>
    </div>
  );

  // â”€â”€ PIN entry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (selected && !adminMode) {
    return wrap(
      <>
        {header}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--sv-action)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 22, margin: '0 auto .6rem' }}>{initials(selected.name)}</div>
          <div style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--sv-text-strong)' }}>{selected.name}</div>
        </div>
        {!selected.has_pos_pin ? (
          <p style={{ color: 'var(--sv-red)', fontSize: '.88rem', textAlign: 'center', marginBottom: '1rem' }}>No POS PIN set. Contact your manager.</p>
        ) : (
          <>
            <label style={labelStyle}>PIN</label>
            <input ref={pinRef} autoFocus type='password' maxLength={8} value={pin}
              onChange={e => { setPin(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && handlePinLogin()}
              style={inputStyle} placeholder='Enter PIN' />
            {error && <p style={{ color: 'var(--sv-red)', fontSize: '.85rem', margin: '-.5rem 0 .75rem' }}>{error}</p>}
            <button onClick={handlePinLogin} disabled={loading || !pin} style={{ ...primaryBtn, width: '100%' }}>
              {loading ? 'Signing inâ€¦' : 'Sign In'}
            </button>
          </>
        )}
        <button onClick={() => { setSelected(null); setPin(''); setError(''); }} style={{ width: '100%', marginTop: '.75rem', padding: '.6rem', background: 'transparent', border: '1px solid var(--sv-etch)', borderRadius: 8, color: 'var(--sv-text-dim)', cursor: 'pointer', fontSize: '.85rem' }}>â† Back</button>
        {footer}
      </>
    );
  }

  // â”€â”€ Admin email+password fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (adminMode) {
    return wrap(
      <>
        {header}
        <label style={labelStyle}>Email</label>
        <input autoFocus type='email' value={email} onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && passRef.current?.focus()}
          style={inputStyle} placeholder='your@email.com' />
        <label style={labelStyle}>Password</label>
        <input ref={passRef} type='password' value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdminLogin()}
          style={inputStyle} placeholder='password' />
        {error && <p style={{ color: 'var(--sv-red)', fontSize: '.85rem', margin: '-.5rem 0 .75rem' }}>{error}</p>}
        <button onClick={handleAdminLogin} disabled={loading} style={{ ...primaryBtn, width: '100%' }}>
          {loading ? 'Signing inâ€¦' : 'Sign In'}
        </button>
        <button onClick={() => { setAdminMode(false); setError(''); }} style={{ width: '100%', marginTop: '.75rem', padding: '.6rem', background: 'transparent', border: '1px solid var(--sv-etch)', borderRadius: 8, color: 'var(--sv-text-dim)', cursor: 'pointer', fontSize: '.85rem' }}>â† Back</button>
        {footer}
      </>
    );
  }

  // â”€â”€ Staff picker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return wrap(
    <>
      {header}
      <p style={{ margin: '0 0 1rem', fontSize: '.88rem', color: 'var(--sv-text-dim)', textAlign: 'center' }}>Who are you?</p>
      {staffLoading ? (
        <p style={{ textAlign: 'center', color: 'var(--sv-text-dim)', fontSize: '.85rem' }}>Loadingâ€¦</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginBottom: '1rem' }}>
          {staff.map(u => (
            <button key={u.id} onClick={() => { setSelected(u); setPin(''); setError(''); setTimeout(() => pinRef.current?.focus(), 80); }}
              style={{ width: 88, padding: '12px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10, cursor: 'pointer', transition: 'border-color .12s' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: u.has_pos_pin ? 'var(--sv-action)' : 'var(--sv-bg-0)', border: u.has_pos_pin ? 'none' : '2px solid var(--sv-etch)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: u.has_pos_pin ? '#fff' : 'var(--sv-text-dim)', fontWeight: 700, fontSize: 16 }}>{initials(u.name)}</div>
              <span style={{ fontSize: 11, color: 'var(--sv-text-strong)', textAlign: 'center', lineHeight: 1.3 }}>{u.name}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ textAlign: 'center', marginTop: '.5rem' }}>
        <button onClick={() => { setAdminMode(true); setError(''); }} style={{ background: 'none', border: 'none', color: 'var(--sv-text-dim)', cursor: 'pointer', fontSize: '.78rem', textDecoration: 'underline' }}>Admin login</button>
      </div>
      <button onClick={onDeviceSetup} style={{ width: '100%', marginTop: '.75rem', padding: '.6rem', background: 'transparent', border: '1px solid var(--sv-etch)', borderRadius: 8, color: 'var(--sv-text-dim)', cursor: 'pointer', fontSize: '.85rem' }}>Change Branch / Register</button>
      {footer}
    </>,
    true,
  );
}

// â”€â”€â”€ Main POS Layout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type MainScreen = 'pos' | 'eod' | 'reports' | 'parked' | 'receive-transfers';

function MainPos({
  deviceConfig, session, products, paymentMethods, defaultView,
  offlineMode, openEodOnMount, onEodMounted, onLogout, onReceipt, onSync,
  lastSale, onSaleCompleted,
}: {
  deviceConfig:    DeviceConfig;
  session:         PosSession;
  products:        CachedProduct[];
  paymentMethods:  string[];
  defaultView:     string | null;
  offlineMode:     boolean;
  openEodOnMount?: boolean;
  onEodMounted?:   () => void;
  onLogout:        () => void;
  onReceipt:       (sale: CompletedSale) => void;
  onSync:          () => Promise<void>;
  lastSale:        CompletedSale | null;
  onSaleCompleted: (sale: CompletedSale) => void;
}) {
  const [screen, setScreen] = useState<MainScreen>('pos');
  const [cart, setCart] = useState<CartItem[]>(() => loadCurrentCart());
  const [parkedSales, setParkedSales] = useState<ParkedSale[]>(() => loadParkedSales());
  const [showPayment, setShowPayment] = useState(false);
  const [isReturn, setIsReturn] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [saleNotes, setSaleNotes] = useState('');
  const [isLayby, setIsLayby] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [queueCount, setQueueCount] = useState(() => loadOfflineQueue().length);
  const [failedCount, setFailedCount] = useState(() => loadFailedQueue().length);
  const [queueInspectOpen, setQueueInspectOpen] = useState(false);
  const [cartLeft, setCartLeft] = useState(() => { try { return localStorage.getItem('pos_cart_left') === '1'; } catch { return false; } });
  // undefined = still fetching, null = no open session, object = session is open
  const [regSession, setRegSession] = useState<any>(session.register_id ? undefined : null);
  const submittingRef = useRef(false);
  // Tracks whether we entered the EOD screen from the RegisterGate "Close Properly" path.
  const eodFromGateRef = useRef(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (!session.register_id) { setRegSession(null); return; }
    fetch(`/api/pos/register/session?register_id=${session.register_id}`)
      .then(r => r.json())
      .then(d => setRegSession(d.session ?? null))
      .catch(() => setRegSession(null)); // don't block on network error
  }, [session.register_id]);

  // If the outer PosPage signalled "go straight to EOD" (from register gate close path),
  // navigate the inner screen immediately and acknowledge so the flag is cleared.
  useEffect(() => {
    if (openEodOnMount) {
      eodFromGateRef.current = true;
      setScreen('eod');
      onEodMounted?.();
    }
  }, [openEodOnMount]); // eslint-disable-line react-hooks/exhaustive-deps

  // True only when we have confirmed (fetch done) that no register session is open.
  // undefined = still loading â€” we don't block yet to avoid flash-of-disabled state.
  const mustOpenRegister = !!session.register_id && regSession === null;

  function refreshQueueCount() { setQueueCount(loadOfflineQueue().length); setFailedCount(loadFailedQueue().length); }

  function discardQueueEntry(localId: string, fromFailed: boolean) {
    if (!confirm('Discard this queued sale?\n\nOnly do this if the sale never happened or was already recorded another way. This cannot be undone.')) return;
    if (fromFailed) removeFromFailedQueue(localId);
    else removeFromOfflineQueue(localId);
    refreshQueueCount();
  }

  function retryFailedSales() {
    retryFailedQueue();
    refreshQueueCount();
    drainOfflineQueue().then(refreshQueueCount);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      await drainOfflineQueue();
      refreshQueueCount();
      await onSync();
      setSyncMsg('âœ“ Synced');
    } catch {
      setSyncMsg('Sync failed');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 3000);
    }
  }

  // Persist cart on change
  useEffect(() => { saveCurrentCart(cart); }, [cart]);

  // Drain offline queue on mount and when online
  useEffect(() => {
    drainOfflineQueue().then(refreshQueueCount);
    const handleOnline  = () => { setIsOnline(true);  drainOfflineQueue().then(refreshQueueCount); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Keep the product cache fresh (TTL). On a long-lived terminal the initial
  // load may be hours old, so re-pull prices/stock in the background when the
  // tab regains focus or on a periodic check. When offline and the cache is
  // stale we can't refresh â€” surface a warning banner instead.
  const [cacheStale, setCacheStale] = useState(false);
  const onSyncRef = useRef(onSync);
  useEffect(() => { onSyncRef.current = onSync; }, [onSync]);
  useEffect(() => {
    let cancelled = false;
    async function checkFreshness() {
      if (cancelled) return;
      const stale = isProductsCacheStale();
      if (stale && (typeof navigator === 'undefined' || navigator.onLine)) {
        // Online + stale â†’ refresh silently; onSync re-stamps the cache.
        try { await onSyncRef.current(); } catch {/* keep stale cache */}
        if (!cancelled) setCacheStale(isProductsCacheStale());
      } else {
        setCacheStale(stale);
      }
    }
    checkFreshness();
    const onVisible = () => { if (document.visibilityState === 'visible') checkFreshness(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', checkFreshness);
    const interval = setInterval(checkFreshness, 15 * 60 * 1000); // re-check every 15 min
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', checkFreshness);
      clearInterval(interval);
    };
  }, []);

  const totals = useMemo(() => calcTotals(cart), [cart]);

  function addToCart(product: CachedProduct) {
    setCart(prev => {
      const existing = prev.find(i => i.variant_id === product.variant_id);
      if (existing) {
        return prev.map(i => i.variant_id === product.variant_id
          ? { ...i, qty: i.qty + 1, line_total: calcLineTotal({ ...i, qty: i.qty + 1 }) }
          : i
        );
      }
      const qty = isReturn ? -1 : 1;
      const item: CartItem = {
        localId:        newLocalId(),
        variant_id:     product.variant_id,
        code:           product.code,
        name:           product.name,
        qty,
        unit_price:     product.price,
        original_price: product.price,
        discount_type:  'none',
        discount_value: 0,
        discount_amount: 0,
        tax_rate:       10,
        line_total:     Math.abs(qty) * product.price,
      };
      return [...prev, item];
    });
  }

  function updateQty(localId: string, delta: number) {
    setCart(prev => prev.map(i => {
      if (i.localId !== localId) return i;
      const newQty = i.qty + delta;
      if (newQty === 0) return { ...i, qty: 0 }; // will be removed in filter
      const updated = { ...i, qty: newQty };
      return { ...updated, line_total: calcLineTotal(updated) };
    }).filter(i => i.qty !== 0));
  }

  function removeItem(localId: string) {
    setCart(prev => prev.filter(i => i.localId !== localId));
  }

  function updateDiscount(localId: string, type: 'percent' | 'amount', value: number) {
    setCart(prev => prev.map(i => {
      if (i.localId !== localId) return i;
      const base = i.qty * i.unit_price;
      const discAmt = type === 'percent' ? base * (value / 100) : value;
      const updated = { ...i, discount_type: type, discount_value: value, discount_amount: Math.min(discAmt, base) };
      return { ...updated, line_total: calcLineTotal(updated) };
    }));
  }

  function updatePrice(localId: string, price: number) {
    setCart(prev => prev.map(i => {
      if (i.localId !== localId) return i;
      const updated = { ...i, unit_price: price };
      return { ...updated, line_total: calcLineTotal(updated) };
    }));
  }

  function clearCart() {
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setSaleNotes('');
    setIsLayby(false);
    setIsReturn(false);
    saveCurrentCart([]);
  }

  function parkSale() {
    if (!cart.length) return;
    const label = window.prompt('Park label (optional):') ?? `Parked ${new Date().toLocaleTimeString()}`;
    const parked: ParkedSale = {
      local_id:    newLocalId(),
      label,
      total:       totals.total,
      items:       cart,
      created_at:  new Date().toISOString(),
      customer_name: customerName || undefined,
    };
    const next = [...parkedSales, parked];
    setParkedSales(next);
    saveParkedSales(next);
    clearCart();
  }

  function retrieveParked(sale: ParkedSale) {
    setCart(sale.items);
    setCustomerName(sale.customer_name ?? '');
    const next = parkedSales.filter(p => p.local_id !== sale.local_id);
    setParkedSales(next);
    saveParkedSales(next);
    setScreen('pos');
  }

  async function completeSale(payments: PaymentEntry[]) {
    // Re-entrancy guard â€” prevents a double-fired handler (double-click / key event)
    // from creating two sales. Each completeSale generates a fresh local_id, so the
    // DB UNIQUE(local_id) constraint would NOT catch a double-invocation.
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      const localId = newLocalId();
      const now = new Date().toISOString();
      const { subtotal, discount_total, tax_total, total } = totals;

      const payload = {
        local_id:       localId,
        location_id:    session.location_id,
        cashier_id:     session.pos_user_id,
        sale_type:      isLayby ? 'layby' : isReturn ? 'return' : 'sale',
        status:         isLayby ? 'layby_active' : 'completed',
        customer_name:  customerName || null,
        customer_phone: customerPhone || null,
        notes:          saleNotes || null,
        subtotal, discount_total, tax_total, total,
        items:    cart.map(i => ({ variant_id: i.variant_id, code: i.code, name: i.name, qty: i.qty, unit_price: i.unit_price, original_price: i.original_price, discount_type: i.discount_type, discount_value: i.discount_value, discount_amount: i.discount_amount, tax_rate: i.tax_rate, line_total: i.line_total })),
        payments: payments.map(p => ({ payment_method: p.method, amount: p.amount, reference: p.reference || null })),
      };

      let serverId: number | null = null;
      try {
        if (navigator.onLine) {
          const res = await fetch('/api/pos/sales', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (res.ok) serverId = data.id;
          else addToOfflineQueue(payload);
        } else {
          addToOfflineQueue(payload);
        }
      } catch {
        addToOfflineQueue(payload);
      }
      refreshQueueCount();

      const completedSale: CompletedSale = {
        id:            serverId,
        local_id:      localId,
        location_name: session.location_name,
        cashier_name:  session.full_name,
        sale_type:     isLayby ? 'layby' : isReturn ? 'return' : 'sale',
        status:        isLayby ? 'layby_active' : 'completed',
        items:         cart,
        payments,
        subtotal, discount_total, tax_total, total,
        customer_name:  customerName || null,
        customer_phone: customerPhone || null,
        created_at:    now,
      };

      // lastSale is lifted to PosPage â€” notify parent instead
      onSaleCompleted(completedSale);
      clearCart();
      setShowPayment(false);
      onReceipt(completedSale);
    } finally {
      submittingRef.current = false;
    }
  }

  if (screen === 'receive-transfers') return <ReceiveTransfersScreen session={session} onBack={() => setScreen('pos')} />;
  if (screen === 'eod') return <EodScreen session={session} onBack={() => {
    // Always re-fetch register session when returning from EOD so mustOpenRegister
    // reflects the latest state (closed or newly opened).
    if (session.register_id) {
      fetch(`/api/pos/register/session?register_id=${session.register_id}`)
        .then(r => r.json())
        .then(d => setRegSession(d.session ?? null))
        .catch(() => {});
    }
    eodFromGateRef.current = false;
    setScreen('pos');
  }} />;
  if (screen === 'reports') return <ReportsScreen session={session} onBack={() => setScreen('pos')} />;
  if (screen === 'parked') return (
    <ParkedScreen
      sales={parkedSales}
      onRetrieve={retrieveParked}
      onDelete={(localId) => {
        const next = parkedSales.filter(p => p.local_id !== localId);
        setParkedSales(next); saveParkedSales(next);
      }}
      onBack={() => setScreen('pos')}
    />
  );

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--sv-bg-0)', fontFamily: 'system-ui,sans-serif', color: 'var(--sv-text-main)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '.6rem 1rem', borderBottom: '1px solid var(--sv-etch)', gap: '.5rem', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', marginRight: '.25rem' }}>
          <span style={{ fontWeight: 700, color: 'var(--sv-action)', fontSize: '1rem', letterSpacing: -.2, lineHeight: 1.35 }}>ðŸ›’ POS {session.location_name}</span>
          <span style={{ color: 'var(--sv-text-dim)', fontSize: '.73rem', lineHeight: 1.3 }}>{session.register_name ? `${session.register_name} Â· ` : ''}{session.full_name}</span>
        </div>
        <div style={{ flex: 1 }} />
        {/* Online / Offline badge */}
        <span style={{ display: 'flex', alignItems: 'center', gap: '.3rem', padding: '.15rem .5rem', borderRadius: 99, background: isOnline ? 'rgba(74,222,128,.12)' : 'rgba(248,113,113,.12)', border: `1px solid ${isOnline ? 'rgba(74,222,128,.3)' : 'rgba(248,113,113,.3)'}`, fontSize: '.73rem', fontWeight: 600, color: isOnline ? '#4ade80' : '#f87171', flexShrink: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: isOnline ? '#4ade80' : '#f87171', flexShrink: 0 }} />
          {isOnline ? 'Online' : 'Offline'}
        </span>
        {/* Queued sales badge â€” clickable to inspect entries */}
        {queueCount > 0 && (
          <button
            onClick={() => setQueueInspectOpen(v => !v)}
            title="Click to inspect queued sales"
            style={{ padding: '.15rem .5rem', borderRadius: 99, background: 'rgba(251,191,36,.12)', border: '1px solid rgba(251,191,36,.3)', fontSize: '.73rem', fontWeight: 600, color: '#fbbf24', flexShrink: 0, cursor: 'pointer' }}>
            â³ {queueCount} queued
          </button>
        )}
        {/* Queue inspect panel */}
        {queueInspectOpen && (
          <div style={{ position: 'absolute', top: '3.2rem', left: 0, right: 0, zIndex: 200, background: 'var(--sv-bg-1, #1a1a2e)', border: '1px solid rgba(251,191,36,.35)', borderRadius: 8, padding: '1rem', maxHeight: '70vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24' }}>Queued Sales ({queueCount + failedCount} total)</span>
              <button onClick={() => setQueueInspectOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--sv-text-dim)', cursor: 'pointer', fontSize: 16 }}>âœ•</button>
            </div>
            {[...loadOfflineQueue().map(e => ({ ...e, fromFailed: false })), ...loadFailedQueue().map(e => ({ ...e, fromFailed: true }))].map((entry, i) => {
              const p = entry.payload as any;
              const lid = p?.local_id ?? `entry-${i}`;
              return (
                <div key={lid} style={{ background: 'var(--sv-bg-2, #111)', borderRadius: 6, padding: '10px 12px', marginBottom: 8, border: `1px solid ${entry.fromFailed ? 'rgba(248,113,113,.3)' : 'rgba(251,191,36,.2)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                      <span style={{ padding: '1px 6px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: entry.fromFailed ? 'rgba(248,113,113,.15)' : 'rgba(251,191,36,.13)', color: entry.fromFailed ? '#f87171' : '#fbbf24', marginRight: 6 }}>{entry.fromFailed ? 'FAILED' : 'QUEUED'}</span>
                      <span style={{ color: 'var(--sv-text-dim)' }}>{new Date(entry.queued_at).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      {p?.total != null && <span style={{ marginLeft: 10, fontWeight: 600 }}>${Number(p.total).toFixed(2)}</span>}
                      {p?.items?.length > 0 && <span style={{ marginLeft: 8, color: 'var(--sv-text-dim)' }}>{p.items.length} item{p.items.length !== 1 ? 's' : ''}</span>}
                      {entry.attempts > 0 && <span style={{ marginLeft: 8, color: '#f87171' }}>{entry.attempts} attempt{entry.attempts !== 1 ? 's' : ''}{entry.last_error ? ` â€” ${entry.last_error}` : ''}</span>}
                    </div>
                    <button
                      onClick={() => discardQueueEntry(lid, entry.fromFailed)}
                      title="Discard this queued sale"
                      style={{ background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.3)', borderRadius: 4, cursor: 'pointer', padding: '2px 8px', fontSize: 11, color: '#f87171', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      Discard
                    </button>
                  </div>
                  {p?.local_id && <div style={{ fontSize: 10, color: 'var(--sv-text-dim)', marginTop: 2, fontFamily: 'monospace' }}>ID: {p.local_id}</div>}
                </div>
              );
            })}
            {(queueCount + failedCount === 0) && <div style={{ color: 'var(--sv-text-dim)', fontSize: 13 }}>No queued entries.</div>}
          </div>
        )}
        {/* Failed-sync badge â€” sales that repeatedly failed to sync (never lost) */}
        {failedCount > 0 && (
          <button
            onClick={retryFailedSales}
            title="These sales repeatedly failed to sync and are saved on this device. Click to retry now."
            style={{ padding: '.15rem .5rem', borderRadius: 99, background: 'rgba(248,113,113,.14)', border: '1px solid rgba(248,113,113,.4)', fontSize: '.73rem', fontWeight: 700, color: '#f87171', flexShrink: 0, cursor: 'pointer' }}
          >
            âš  {failedCount} failed â€” retry
          </button>
        )}
        <button
          onClick={handleSync}
          disabled={syncing}
          style={{ ...smallBtn, background: 'rgba(255,255,255,.1)', color: syncMsg === 'âœ“ Synced' ? 'var(--sv-green, #4ade80)' : syncMsg ? 'var(--sv-red)' : 'var(--sv-text-strong)', border: `1px solid ${syncMsg === 'âœ“ Synced' ? 'rgba(74,222,128,.35)' : syncMsg ? 'var(--sv-red-border)' : 'rgba(255,255,255,.18)'}`, opacity: syncing ? .7 : 1 }}
        >
          {syncing ? 'âŸ³ Syncingâ€¦' : syncMsg ?? 'âŸ³ Sync'}
        </button>
        <button onClick={() => setIsReturn(!isReturn)} style={{ ...smallBtn, background: isReturn ? 'var(--sv-red-tint)' : 'rgba(255,255,255,.1)', color: isReturn ? 'var(--sv-red)' : 'var(--sv-text-strong)', border: `1px solid ${isReturn ? 'var(--sv-red-border)' : 'rgba(255,255,255,.18)'}` }}>
          {isReturn ? 'â†© Return Mode ON' : 'Return / Refund'}
        </button>
        <button onClick={() => setIsLayby(!isLayby)} style={{ ...smallBtn, background: isLayby ? 'var(--sv-amber-tint)' : 'rgba(255,255,255,.1)', color: isLayby ? 'var(--sv-amber)' : 'var(--sv-text-strong)', border: `1px solid ${isLayby ? 'var(--sv-amber-border)' : 'rgba(255,255,255,.18)'}` }}>
          {isLayby ? 'ðŸ“‹ Layby ON' : 'Layby'}
        </button>
        <button onClick={parkSale} style={{ ...smallBtn, background: 'rgba(255,255,255,.1)', color: 'var(--sv-text-strong)', border: '1px solid rgba(255,255,255,.18)' }} disabled={!cart.length}>Park Sale</button>
        <button onClick={() => setScreen('parked')} style={{ ...smallBtn, background: 'rgba(255,255,255,.1)', color: 'var(--sv-text-strong)', border: '1px solid rgba(255,255,255,.18)' }}>
          Parked {parkedSales.length > 0 ? `(${parkedSales.length})` : ''}
        </button>
        <button
          onClick={() => lastSale && onReceipt(lastSale)}
          disabled={!lastSale}
          title={lastSale ? 'Reprint last receipt' : 'No recent sale to reprint'}
          style={{ ...smallBtn, background: 'rgba(255,255,255,.1)', color: lastSale ? 'var(--sv-text-strong)' : 'var(--sv-text-dim)', border: '1px solid rgba(255,255,255,.18)', opacity: lastSale ? 1 : .45 }}
        >ðŸ” Reprint</button>
        <button onClick={() => setScreen('eod')} style={{ ...smallBtn, background: 'rgba(255,255,255,.1)', color: 'var(--sv-text-strong)', border: '1px solid rgba(255,255,255,.18)' }}>Register</button>
        <button onClick={() => setScreen('reports')} style={{ ...smallBtn, background: 'rgba(255,255,255,.1)', color: 'var(--sv-text-strong)', border: '1px solid rgba(255,255,255,.18)' }}>Reports</button>
        <button onClick={() => setScreen('receive-transfers')} style={{ ...smallBtn, background: 'rgba(255,255,255,.1)', color: 'var(--sv-text-strong)', border: '1px solid rgba(255,255,255,.18)' }}>ðŸ“¦ Receive Transfers</button>
        <button
          onClick={() => setCartLeft(v => { const next = !v; try { localStorage.setItem('pos_cart_left', next ? '1' : '0'); } catch {} return next; })}
          title={cartLeft ? 'Cart on left â€” click to move right' : 'Cart on right â€” click to move left'}
          style={{ ...smallBtn, background: 'rgba(255,255,255,.1)', color: 'var(--sv-text-dim)', border: '1px solid rgba(255,255,255,.18)' }}
        >{cartLeft ? 'â¬… Cart' : 'Cart âž¡'}</button>
        <button
          onClick={() => setHelpOpen(true)}
          title="Help"
          style={{ ...smallBtn, background: 'rgba(255,255,255,.1)', color: 'var(--sv-text-dim)', border: '1px solid rgba(255,255,255,.18)', padding: '5px 8px' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17" strokeLinecap="round" strokeWidth="2.5"/></svg>
        </button>
        <button onClick={onLogout} style={{ ...smallBtn, background: 'rgba(255,255,255,.1)', color: 'var(--sv-red)', border: '1px solid var(--sv-red-border)' }}>Log Out</button>
      </div>

      {/* Stale-cache banner â€” prices/stock may be out of date and can't be refreshed while offline */}
      {cacheStale && (
        <div style={{ background: 'rgba(248,113,113,.1)', borderBottom: '1px solid rgba(248,113,113,.25)', padding: '.3rem 1rem', fontSize: '.78rem', color: '#f87171', display: 'flex', alignItems: 'center', gap: '.5rem', flexShrink: 0 }}>
          <span style={{ fontWeight: 700 }}>Product prices may be out of date</span>
          <span style={{ color: 'var(--sv-text-dim)' }}>
            This terminal hasn&apos;t refreshed its catalogue in over {Math.round(PRODUCTS_CACHE_TTL_MS / 3600000)} hours. Verify prices before charging; sync once back online to update.
          </span>
        </div>
      )}

      {/* Offline-mode banner (loaded from cache, no server contact) */}
      {offlineMode && (
        <div style={{ background: 'rgba(251,191,36,.12)', borderBottom: '1px solid rgba(251,191,36,.25)', padding: '.3rem 1rem', fontSize: '.78rem', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '.5rem', flexShrink: 0 }}>
          <span style={{ fontWeight: 700 }}>âš ï¸ Offline mode</span>
          <span style={{ color: 'var(--sv-text-dim)' }}>Running from cached data. Sales are queued locally and will sync when connection is restored. Press âŸ³Â Sync once back online.</span>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', flexDirection: cartLeft ? 'row-reverse' : 'row', overflow: 'hidden' }}>
        {/* Product Panel â€” only render once defaultView is known to avoid flash */}
        {defaultView !== null ? (
          <ProductPanel products={products} onAdd={addToCart} isReturn={isReturn} defaultView={defaultView} onChargeEnter={() => { if (cart.length && !showPayment && !mustOpenRegister) setShowPayment(true); }} />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sv-text-dim)', fontSize: '.9rem' }}>Loading productsâ€¦</div>
        )}

        {/* Cart Panel */}
        <div style={{ width: 520, display: 'flex', flexDirection: 'column', borderLeft: cartLeft ? 'none' : '1px solid var(--sv-etch)', borderRight: cartLeft ? '1px solid var(--sv-etch)' : 'none', background: 'var(--sv-bg-1)' }}>
          {/* Customer info */}
          <div style={{ padding: '.5rem .75rem', display: 'flex', gap: '.5rem' }}>
            <input placeholder='Customer name' value={customerName} onChange={e => setCustomerName(e.target.value)} style={{ ...inputStyle, flex: 1, marginBottom: 0, padding: '.35rem .5rem', fontSize: '.8rem' }} />
            <input placeholder='Phone' value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} style={{ ...inputStyle, width: 110, marginBottom: 0, padding: '.35rem .5rem', fontSize: '.8rem' }} />
          </div>

          {/* Order notes */}
          <div style={{ padding: '0 .75rem .4rem' }}>
            <input placeholder='Order notes (optional)' value={saleNotes} onChange={e => setSaleNotes(e.target.value)} style={{ ...inputStyle, width: '100%', marginBottom: 0, padding: '.35rem .5rem', fontSize: '.8rem', boxSizing: 'border-box' }} />
          </div>

          {/* Cart items */}
          <div style={{ flex: 1, overflow: 'auto', padding: '.5rem .75rem' }}>
            {cart.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--sv-text-muted)', paddingTop: '3rem', fontSize: '.9rem' }}>Cart is empty.<br/>Click a product to add.</div>
            )}
            {cart.map(item => (
              <CartRow
                key={item.localId}
                item={item}
                onQty={(d) => updateQty(item.localId, d)}
                onRemove={() => removeItem(item.localId)}
                onDiscount={(t, v) => updateDiscount(item.localId, t, v)}
                onPrice={(p) => updatePrice(item.localId, p)}
              />
            ))}
          </div>

          {/* Totals */}
          <div style={{ padding: '.75rem' }}>
            <TotalRow label='Subtotal' value={totals.subtotal} />
            {totals.discount_total > 0 && <TotalRow label='Discount' value={-totals.discount_total} color='var(--sv-amber)' />}
            <TotalRow label='GST (incl.)' value={totals.tax_total} muted />
            <TotalRow label='TOTAL' value={totals.total} large />

            {mustOpenRegister && (
              <div style={{ marginTop: '.75rem', padding: '.6rem .75rem', background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.35)', borderRadius: 8, fontSize: '.8rem', color: '#f87171', lineHeight: 1.5, textAlign: 'center' }}>
                <strong>Register not open.</strong> Go to{' '}
                <button
                  onClick={() => setScreen('eod')}
                  style={{ background: 'none', border: 'none', color: '#fb923c', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 'inherit', fontWeight: 700 }}
                >
                  End of Day
                </button>
                {' '}and open the register before taking sales.
              </div>
            )}
            <div style={{ display: 'flex', gap: '.5rem', marginTop: '.75rem', flexDirection: 'column' }}>
              <button onClick={clearCart} style={{ ...smallBtn, width: '100%', padding: '.55rem', fontSize: '.85rem', background: 'transparent', border: '1px solid rgba(248,113,113,.5)', color: '#ef4444', opacity: !cart.length ? 0.65 : 1 }} disabled={!cart.length}>Clear Cart</button>
              <button
                onClick={() => { if (!mustOpenRegister) setShowPayment(true); }}
                disabled={!cart.length || mustOpenRegister}
                style={{ width: '100%', padding: '1rem .5rem', background: cart.length && !mustOpenRegister ? 'var(--sv-action)' : 'var(--sv-bg-2)', border: `2px solid ${cart.length && !mustOpenRegister ? 'var(--sv-action)' : 'var(--sv-etch)'}`, borderRadius: 10, color: cart.length && !mustOpenRegister ? '#fff' : 'var(--sv-text-muted)', cursor: cart.length && !mustOpenRegister ? 'pointer' : 'not-allowed', fontWeight: 900, lineHeight: 1.15, transition: 'opacity .15s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.1rem' }}
              >
                <span style={{ fontSize: '1rem', letterSpacing: .5, textTransform: 'uppercase' }}>{isLayby ? 'Layby' : 'Charge'}</span>
                <span style={{ fontSize: '2.6rem', letterSpacing: -1, fontWeight: 900 }}>${fmt(totals.total)}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {showPayment && (
        <PaymentModal
          total={totals.total}
          methods={paymentMethods}
          isLayby={isLayby}
          onComplete={completeSale}
          onCancel={() => setShowPayment(false)}
        />
      )}
      <PosHelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

// â”€â”€â”€ Recent product helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function loadRecentIds(): string[] {
  try { return JSON.parse(localStorage.getItem('pos_recent_vids') ?? '[]'); } catch { return []; }
}
function saveRecentIds(ids: string[]): void {
  try { localStorage.setItem('pos_recent_vids', JSON.stringify(ids)); } catch {}
}

// â”€â”€â”€ POS Stock Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function PosStockModal({ variantId, productName, onClose }: { variantId: string; productName: string; onClose: () => void }) {
  const [rows, setRows]       = useState<{ location_name: string; qty_on_hand: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    fetch(`/api/ims/stock?variant_id=${encodeURIComponent(variantId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setRows((d.data ?? []).map((r: any) => ({ location_name: r.location_name ?? `Loc ${r.location_id}`, qty_on_hand: Number(r.qty_on_hand ?? 0) })));
        else setError(d.error ?? 'Failed to load stock.');
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [variantId]);

  const total = rows.reduce((s, r) => s + r.qty_on_hand, 0);

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 12, padding: '1.5rem', width: 400, maxWidth: '95vw', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 12px 48px rgba(0,0,0,.5)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem', gap: 12 }}>
          <div>
            <div style={{ fontSize: '.72rem', color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: .8, marginBottom: 2 }}>Stock by Location</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--sv-text-strong)', lineHeight: 1.3 }}>{productName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sv-text-dim)', fontSize: 22, lineHeight: 1, padding: 0, flexShrink: 0 }}>Ã—</button>
        </div>
        {loading && <div style={{ textAlign: 'center', color: 'var(--sv-text-dim)', padding: '1.5rem 0' }}>Loadingâ€¦</div>}
        {error  && <div style={{ color: 'var(--sv-red)', fontSize: '.85rem' }}>{error}</div>}
        {!loading && !error && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: 8 }}>
            {rows.map(r => (
              <div key={r.location_name} style={{ background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: '.72rem', color: 'var(--sv-text-dim)', fontWeight: 600, marginBottom: 4 }}>{r.location_name}</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: r.qty_on_hand === 0 ? 'var(--sv-text-dim)' : 'var(--sv-text-strong)' }}>{r.qty_on_hand}</div>
              </div>
            ))}
            {rows.length > 1 && (
              <div style={{ background: 'color-mix(in srgb, var(--sv-action) 12%, transparent)', border: '1px solid var(--sv-action)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: '.72rem', color: 'var(--sv-action)', fontWeight: 700, marginBottom: 4 }}>TOTAL</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--sv-action)' }}>{total}</div>
              </div>
            )}
            {rows.length === 0 && <div style={{ color: 'var(--sv-text-dim)', fontSize: '.85rem', gridColumn: '1/-1' }}>No stock records found.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// â”€â”€â”€ Product Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ProductPanel({ products, onAdd, isReturn, onChargeEnter, defaultView = 'all' }: { products: CachedProduct[]; onAdd: (p: CachedProduct) => void; isReturn: boolean; onChargeEnter?: () => void; defaultView?: string }) {
  const [search, setSearch]             = useState('');
  const [brand, setBrand]               = useState(() => defaultView.startsWith('brand:') ? defaultView.slice(6) : '');
  const [inStockOnly, setInStockOnly]   = useState(() => defaultView === 'in_stock');
  const [stockModal, setStockModal]     = useState<{ variantId: string; productName: string } | null>(null);

  // Pinned variant IDs from the "Specific Products" setting
  const pinnedIds = useMemo(() => {
    if (!defaultView.startsWith('variants:')) return null;
    const ids = defaultView.slice(9).split(',').filter(Boolean);
    return ids.length ? new Set(ids) : null;
  }, [defaultView]);
  const [mode, setMode]                 = useState<'browse' | 'search'>('browse');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [recentIds, setRecentIds]       = useState<string[]>(() => loadRecentIds());

  const inputRef      = useRef<HTMLInputElement>(null);
  const barcodeBuffer = useRef('');
  const barcodeTimer  = useRef<NodeJS.Timeout>();
  const blurTimer     = useRef<NodeJS.Timeout>();
  // Refs for stale-closure-safe reads inside the keydown handler
  const dropItemsRef  = useRef<CachedProduct[]>([]);
  const highlightRef  = useRef(-1);
  const searchRef     = useRef('');
  highlightRef.current = highlightIdx;
  searchRef.current    = search;

  // Defer the expensive grid filter so keystrokes feel instant
  const deferredSearch = useDeferredValue(search);
  const deferredMode   = useDeferredValue(mode);

  // Focus search on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Add to cart + track recency
  const handleAdd = useCallback((p: CachedProduct) => {
    onAdd(p);
    setRecentIds(prev => {
      const updated = [p.variant_id, ...prev.filter(id => id !== p.variant_id)].slice(0, 50);
      saveRecentIds(updated);
      return updated;
    });
    setSearch('');
    setDropdownOpen(false);
    setHighlightIdx(-1);
    setMode('browse');
  }, [onAdd]);

  const brands = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => { if (p.brand) set.add(p.brand); });
    return Array.from(set).sort();
  }, [products]);

  // Smart sort: in-stock first, then most recently used, then alphabetical
  const sortedProducts = useMemo(() => {
    return [...products].sort((a, b) => {
      const stockDiff = (a.soh > 0 ? 0 : 1) - (b.soh > 0 ? 0 : 1);
      if (stockDiff !== 0) return stockDiff;
      const aR = recentIds.indexOf(a.variant_id);
      const bR = recentIds.indexOf(b.variant_id);
      const rDiff = (aR === -1 ? 9999 : aR) - (bR === -1 ? 9999 : bR);
      if (rDiff !== 0) return rDiff;
      return a.name.localeCompare(b.name);
    });
  }, [products, recentIds]);

  const matchQuery = (p: CachedProduct, q: string) =>
    p.name.toLowerCase().includes(q) ||
    (p.code ?? '').toLowerCase().includes(q) ||
    (p.barcode ?? '').includes(q) ||
    (p.brand ?? '').toLowerCase().includes(q);

  // Top 8 quick-select matches for the dropdown (shown while typing)
  const dropdownItems = useMemo(() => {
    if (search.length < 2) return [];
    const q = search.toLowerCase();
    let list = brand ? sortedProducts.filter(p => p.brand === brand) : sortedProducts;
    return list.filter(p => matchQuery(p, q)).slice(0, 8);
  }, [sortedProducts, brand, search]);

  // Main grid products: browse = smart-sorted full list; search = filtered
  // Uses deferredSearch/deferredMode so the grid update is low-priority â€” keystrokes stay instant
  const filtered = useMemo(() => {
    let list = inStockOnly ? sortedProducts.filter(p => p.soh > 0) : sortedProducts;
    if (brand) list = list.filter(p => p.brand === brand);
    // In browse mode, if specific variants are pinned, restrict to those only
    if (deferredMode === 'browse' && !deferredSearch.trim() && pinnedIds) {
      list = list.filter(p => pinnedIds.has(p.variant_id));
    }
    if (deferredMode === 'search' && deferredSearch.trim()) {
      const q = deferredSearch.toLowerCase();
      list = list.filter(p => matchQuery(p, q));
    }
    return list;
  }, [sortedProducts, brand, inStockOnly, pinnedIds, deferredMode, deferredSearch]);

  // Keep dropItemsRef current so the keydown handler always sees the latest list
  dropItemsRef.current = dropdownItems;

  // Barcode scanner + keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target !== document.body && e.target !== inputRef.current) return;
      if (e.key === 'Enter') {
        if (barcodeBuffer.current.length > 3) {
          const code = barcodeBuffer.current;
          const found = products.find(p => p.barcode === code || p.code === code);
          if (found) handleAdd(found);
          barcodeBuffer.current = '';
          clearTimeout(barcodeTimer.current);
          return;
        }
        barcodeBuffer.current = '';
        // Add highlighted dropdown item if one is selected
        const hi = highlightRef.current;
        const items = dropItemsRef.current;
        if (hi >= 0 && items[hi]) { handleAdd(items[hi]); return; }
        // Otherwise enter search-results grid mode
        if (searchRef.current.trim()) {
          setMode('search');
          setDropdownOpen(false);
          setHighlightIdx(-1);
        } else {
          // Empty search + Enter â†’ open payment / charge
          onChargeEnter?.();
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setDropdownOpen(true);
        setHighlightIdx(i => Math.min(i + 1, dropItemsRef.current.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx(i => Math.max(i - 1, -1));
      } else if (e.key === 'Escape') {
        setDropdownOpen(false);
        setHighlightIdx(-1);
        setSearch('');
        setMode('browse');
      } else if (e.key.length === 1) {
        barcodeBuffer.current += e.key;
        clearTimeout(barcodeTimer.current);
        barcodeTimer.current = setTimeout(() => { barcodeBuffer.current = ''; }, 100);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [products, handleAdd]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Search bar */}
      <div style={{ padding: '.5rem .75rem', background: 'var(--sv-bg-1)', borderBottom: '1px solid var(--sv-etch)', display: 'flex', gap: '.5rem', alignItems: 'center' }}>
        {/* Input + dropdown wrapper */}
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            ref={inputRef}
            value={search}
            onChange={e => {
              const val = e.target.value;
              setSearch(val);
              if (val.length >= 2) { setDropdownOpen(true); setHighlightIdx(-1); }
              else { setDropdownOpen(false); }
              if (!val) setMode('browse');
            }}
            onFocus={() => { if (search.length >= 2) setDropdownOpen(true); }}
            onBlur={() => { blurTimer.current = setTimeout(() => setDropdownOpen(false), 150); }}
            placeholder='Search by name, brand or scan barcodeâ€¦'
            style={{ ...inputStyle, width: '100%', marginBottom: 0, background: 'var(--sv-bg-0)', border: '1px solid var(--sv-text-dim)' }}
          />
          {/* Autocomplete dropdown */}
          {dropdownOpen && dropdownItems.length > 0 && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50, background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,.5)' }}>
              {dropdownItems.map((p, i) => (
                <div
                  key={p.variant_id}
                  onMouseDown={e => { e.preventDefault(); clearTimeout(blurTimer.current); handleAdd(p); }}
                  onMouseEnter={() => setHighlightIdx(i)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', background: i === highlightIdx ? 'var(--sv-bg-2)' : 'transparent', borderBottom: i < dropdownItems.length - 1 ? '1px solid var(--sv-etch)' : 'none' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--sv-text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div style={{ fontSize: '.72rem', color: 'var(--sv-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[p.brand, p.code].filter(Boolean).join(' Â· ')}</div>
                  </div>
                  <span style={{ fontWeight: 700, color: 'var(--sv-action)', fontSize: '.85rem', flexShrink: 0 }}>${fmt(p.price)}</span>
                  <button onMouseDown={e => { e.stopPropagation(); e.preventDefault(); clearTimeout(blurTimer.current); setStockModal({ variantId: p.variant_id, productName: p.name }); }} style={{ fontSize: '.72rem', padding: '2px 6px', borderRadius: 5, background: p.soh > 0 ? 'var(--sv-mint-tint)' : 'var(--sv-red-tint)', color: p.soh > 0 ? 'var(--sv-mint)' : 'var(--sv-red)', flexShrink: 0, border: 'none', cursor: 'pointer', fontWeight: 700 }} title="Stock at this store â€” click for breakdown">{p.soh > 0 ? p.soh : 'OOS'}</button>
                  {p.soh_all !== undefined && p.soh_all !== p.soh && (
                    <button onMouseDown={e => { e.stopPropagation(); e.preventDefault(); clearTimeout(blurTimer.current); setStockModal({ variantId: p.variant_id, productName: p.name }); }} style={{ fontSize: '.72rem', padding: '2px 5px', borderRadius: 5, background: 'var(--sv-bg-2)', color: 'var(--sv-text-dim)', flexShrink: 0, border: '1px solid var(--sv-etch)', cursor: 'pointer' }} title="Total across all locations â€” click for breakdown">all:{p.soh_all}</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {/* In-stock only toggle */}
        <button
          onClick={() => setInStockOnly(v => !v)}
          title={inStockOnly ? 'Showing in-stock only â€” click to show all' : 'Show in-stock only'}
          style={{ flexShrink: 0, padding: '5px 9px', borderRadius: 6, border: `1px solid ${inStockOnly ? 'var(--sv-mint)' : 'var(--sv-etch)'}`, background: inStockOnly ? 'var(--sv-mint-tint)' : 'transparent', color: inStockOnly ? 'var(--sv-mint)' : 'var(--sv-text-dim)', cursor: 'pointer', fontSize: 12, fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap' }}
        >In Stock</button>
        {/* Search button: commits to full grid results mode */}
        <button
          onClick={() => { if (search.trim()) { setMode('search'); setDropdownOpen(false); setHighlightIdx(-1); inputRef.current?.focus(); } }}
          disabled={!search.trim()}
          title="Show all matching products"
          style={{ flexShrink: 0, padding: '6px 11px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: search.trim() ? 'var(--sv-bg-2)' : 'transparent', color: search.trim() ? 'var(--sv-action)' : 'var(--sv-text-muted)', cursor: search.trim() ? 'pointer' : 'default', fontSize: 15, lineHeight: 1 }}
        >ðŸ”</button>
      </div>

      {/* Search results banner */}
      {mode === 'search' && (
        <div style={{ padding: '4px 12px 6px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--sv-action)' }}>ðŸ” Results for <strong>"{search}"</strong> â€” {filtered.length} product{filtered.length !== 1 ? 's' : ''}</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => { setMode('browse'); setSearch(''); setDropdownOpen(false); inputRef.current?.focus(); }}
            style={{ fontSize: 12, padding: '2px 10px', borderRadius: 5, border: '1px solid var(--sv-etch)', background: 'none', color: 'var(--sv-text-dim)', cursor: 'pointer' }}
          >Ã— Clear</button>
        </div>
      )}

      {/* Product grid */}
      <div style={{ flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px,1fr))', gap: '.6rem', padding: '.75rem', alignContent: 'start' }}>
        {filtered.map(p => {
          const isRecent = mode === 'browse' && recentIds.includes(p.variant_id);
          return (
            <button
              key={p.variant_id}
              onClick={() => handleAdd(p)}
              style={{
                background: isReturn ? 'var(--sv-red-tint)' : 'var(--sv-bg-2)',
                border: `1px solid ${isRecent ? 'rgba(37,99,235,.35)' : 'var(--sv-etch)'}`,
                borderRadius: 8,
                padding: '.75rem .85rem',
                textAlign: 'left',
                cursor: 'pointer',
                color: 'var(--sv-text-main)',
                position: 'relative',
                transition: 'border-color .15s, background .15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--sv-action)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = isRecent ? 'rgba(37,99,235,.35)' : 'var(--sv-etch)')}
            >
              <div style={{ fontSize: '.75rem', color: 'var(--sv-text-dim)', marginBottom: '.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.brand ?? p.code ?? 'â€”'}</div>
              <div style={{ fontSize: '.9rem', fontWeight: 700, lineHeight: 1.3, color: 'var(--sv-text-strong)', maxHeight: '2.6em', overflow: 'hidden', marginBottom: '.4rem' }}>{p.name}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 800, color: 'var(--sv-action)', fontSize: '1rem' }}>${fmt(p.price)}</span>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <button onClick={e => { e.stopPropagation(); setStockModal({ variantId: p.variant_id, productName: p.name }); }} style={{ fontSize: '.75rem', padding: '.15rem .5rem', borderRadius: 5, background: p.soh > 0 ? 'var(--sv-mint-tint)' : 'var(--sv-red-tint)', color: p.soh > 0 ? 'var(--sv-mint)' : 'var(--sv-red)', fontWeight: 700, border: 'none', cursor: 'pointer' }} title="Stock at this store â€” click for breakdown">
                    {p.soh > 0 ? p.soh : 'OOS'}
                  </button>
                  {p.soh_all !== undefined && p.soh_all !== p.soh && (
                    <button onClick={e => { e.stopPropagation(); setStockModal({ variantId: p.variant_id, productName: p.name }); }} style={{ fontSize: '.72rem', padding: '.1rem .4rem', borderRadius: 5, background: 'var(--sv-bg-0)', color: 'var(--sv-text-dim)', border: '1px solid var(--sv-etch)', cursor: 'pointer' }} title="Total across all locations â€” click for breakdown">all:{p.soh_all}</button>
                  )}
                </div>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ gridColumn: '1/-1', color: 'var(--sv-text-muted)', textAlign: 'center', paddingTop: '2rem', fontSize: '.9rem' }}>
            {mode === 'search' ? `No products found for "${search}".` : 'No products.'}
          </div>
        )}
      </div>
      {stockModal && (
        <PosStockModal
          variantId={stockModal.variantId}
          productName={stockModal.productName}
          onClose={() => setStockModal(null)}
        />
      )}
    </div>
  );
}

// â”€â”€â”€ Cart Row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function CartRow({ item, onQty, onRemove, onDiscount, onPrice }: {
  item: CartItem;
  onQty: (d: number) => void;
  onRemove: () => void;
  onDiscount: (type: 'percent' | 'amount', value: number) => void;
  onPrice: (p: number) => void;
}) {
  const [editPrice, setEditPrice] = useState(false);
  const [editDisc,  setEditDisc]  = useState(false);
  const [priceVal,  setPriceVal]  = useState(String(item.unit_price));
  const [discType,  setDiscType]  = useState<'percent' | 'amount'>(item.discount_type === 'none' ? 'percent' : item.discount_type);
  const [discVal,   setDiscVal]   = useState(String(item.discount_value));

  return (
    <div style={{ borderBottom: '1px solid var(--sv-etch)', paddingBottom: '.5rem', marginBottom: '.5rem' }}>
      <div style={{ display: 'flex', gap: '.4rem', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, fontSize: '.82rem', lineHeight: 1.3 }}>
          <div style={{ fontWeight: 600, color: 'var(--sv-text-strong)' }}>{item.name}</div>
          {item.code && <div style={{ color: 'var(--sv-text-dim)', fontSize: '.75rem' }}>{item.code}</div>}
        </div>
        <button onClick={onRemove} style={{ background: 'transparent', border: 'none', color: 'var(--sv-red)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 .25rem' }}>Ã—</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginTop: '.3rem' }}>
        {/* Qty controls */}
        <button onClick={() => onQty(-1)} style={qtyBtn}>âˆ’</button>
        <span style={{ minWidth: 24, textAlign: 'center', fontSize: '.9rem', fontWeight: 600 }}>{item.qty}</span>
        <button onClick={() => onQty(1)} style={qtyBtn}>+</button>

        {/* Price */}
        {editPrice ? (
          <input
            autoFocus
            value={priceVal}
            onChange={e => setPriceVal(e.target.value)}
            onBlur={() => { onPrice(parseFloat(priceVal) || item.unit_price); setEditPrice(false); }}
            onKeyDown={e => { if (e.key === 'Enter') { onPrice(parseFloat(priceVal) || item.unit_price); setEditPrice(false); } }}
            style={{ width: 70, padding: '.2rem .3rem', background: 'var(--sv-bg-0)', border: '1px solid var(--sv-action)', borderRadius: 4, color: 'var(--sv-text-main)', fontSize: '.85rem' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            {item.original_price != null && item.original_price !== item.unit_price && (
              <span style={{ fontSize: '.65rem', color: 'var(--sv-text-muted)', textDecoration: 'line-through', lineHeight: 1, marginBottom: '.05rem' }}>${fmt(item.original_price)}</span>
            )}
            <button onClick={() => setEditPrice(true)} style={{ background: 'transparent', border: 'none', color: item.original_price != null && item.original_price !== item.unit_price ? '#fb923c' : 'var(--sv-action)', cursor: 'pointer', fontSize: '.85rem', fontWeight: 600, padding: 0 }}>
              ${fmt(item.unit_price)}
            </button>
          </div>
        )}

        {/* Discount */}
        {editDisc ? (
          <div style={{ display: 'flex', gap: '.25rem', alignItems: 'center' }}>
            <select value={discType} onChange={e => setDiscType(e.target.value as 'percent' | 'amount')} style={{ fontSize: '.75rem', padding: '.2rem', background: 'var(--sv-bg-0)', border: '1px solid var(--sv-etch)', color: 'var(--sv-text-main)', borderRadius: 4 }}>
              <option value='percent'>%</option>
              <option value='amount'>$</option>
            </select>
            <input
              autoFocus
              value={discVal}
              onChange={e => setDiscVal(e.target.value)}
              onBlur={() => { onDiscount(discType, parseFloat(discVal) || 0); setEditDisc(false); }}
              onKeyDown={e => { if (e.key === 'Enter') { onDiscount(discType, parseFloat(discVal) || 0); setEditDisc(false); } if (e.key === 'Escape') setEditDisc(false); }}
              style={{ width: 55, padding: '.2rem .3rem', background: 'var(--sv-bg-0)', border: '1px solid var(--sv-amber-border)', borderRadius: 4, color: 'var(--sv-text-main)', fontSize: '.85rem' }}
            />
          </div>
        ) : (
          <button onClick={() => setEditDisc(true)} style={{ background: item.discount_amount > 0 ? 'rgba(251,191,36,.15)' : 'transparent', border: item.discount_amount > 0 ? '1px solid rgba(251,191,36,.4)' : '1px solid transparent', borderRadius: 4, color: item.discount_amount > 0 ? 'var(--sv-amber)' : 'var(--sv-text-muted)', cursor: 'pointer', fontSize: '.75rem', padding: '.15rem .35rem', fontWeight: item.discount_amount > 0 ? 600 : 400, lineHeight: 1.2, whiteSpace: 'nowrap' }}>
            {item.discount_amount > 0
              ? `${item.discount_type === 'percent' ? `${item.discount_value}%` : `$${fmt(item.discount_value)} off`} Â· âˆ’$${fmt(item.discount_amount)}`
              : '+ Disc.'}
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: '.9rem' }}>${fmt(item.line_total)}</span>
      </div>
    </div>
  );
}

// â”€â”€â”€ Total Row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function TotalRow({ label, value, large, muted, color }: { label: string; value: number; large?: boolean; muted?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: large ? '.5rem 0' : '.2rem 0', fontSize: large ? '1.4rem' : '.9rem', fontWeight: large ? 900 : 400, color: color ?? (muted ? 'var(--sv-text-dim)' : large ? 'var(--sv-text-strong)' : 'var(--sv-text-main)'), borderTop: large ? '2px solid var(--sv-etch)' : 'none', marginTop: large ? '.3rem' : 0 }}>
      <span>{label}</span>
      <span>${fmt(Math.abs(value))}{value < 0 ? '' : ''}</span>
    </div>
  );
}

// â”€â”€â”€ Payment Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function PaymentModal({ total, methods, isLayby, onComplete, onCancel }: {
  total:      number;
  methods:    string[];
  isLayby:    boolean;
  onComplete: (payments: PaymentEntry[]) => void;
  onCancel:   () => void;
}) {
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [activeMethod, setActiveMethod] = useState(() => methods.find(m => /card/i.test(m)) ?? methods[0] ?? 'Cash');
  const [amount, setAmount] = useState(() => String(total));
  const [reference, setReference] = useState('');
  const [changeDue, setChangeDue] = useState<{ amount: number; pendingPayments: PaymentEntry[] } | null>(null);
  const amountRef      = useRef<HTMLInputElement>(null);
  const changeDueOkRef  = useRef<HTMLButtonElement>(null);

  const paid      = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = total - paid;
  const change    = Math.max(0, paid - total);

  useEffect(() => { amountRef.current?.focus(); }, [activeMethod]);
  // Delay focus so any in-flight Enter keyup can't immediately click the button
  useEffect(() => { if (changeDue) { const t = setTimeout(() => changeDueOkRef.current?.focus(), 120); return () => clearTimeout(t); } }, [changeDue]);

  function addPayment() {
    const amt = parseFloat(amount) || remaining;
    if (amt <= 0) return;
    const newPayment = { localId: newLocalId(), method: activeMethod, amount: amt, reference };
    const newPayments = [...payments, newPayment];
    const newPaid = newPayments.reduce((s, p) => s + p.amount, 0);
    setPayments(newPayments);
    setAmount('');
    setReference('');
    if (newPaid >= total - 0.001) {
      const changeAmt = Math.round((newPaid - total) * 100) / 100;
      if (changeAmt > 0.004) {
        setChangeDue({ amount: changeAmt, pendingPayments: newPayments });
      } else {
        onComplete(newPayments);
      }
    }
  }

  function removePayment(localId: string) {
    setPayments(prev => prev.filter(p => p.localId !== localId));
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      {/* Change Due overlay â€” shown on top of payment modal */}
      {changeDue && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, borderRadius: 12 }}>
          <div style={{ background: '#1a0000', border: '3px solid #ef4444', borderRadius: 16, padding: '2.5rem 3rem', textAlign: 'center', boxShadow: '0 0 60px rgba(239,68,68,.5)', maxWidth: 360, width: '90vw' }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#ef4444', letterSpacing: 3, textTransform: 'uppercase', marginBottom: '0.5rem' }}>Change Due</div>
            <div style={{ fontSize: '5rem', fontWeight: 900, color: '#ef4444', lineHeight: 1, marginBottom: '2rem', letterSpacing: -2 }}>${fmt(changeDue.amount)}</div>
            <button
              ref={changeDueOkRef}
              onClick={() => { setChangeDue(null); onComplete(changeDue.pendingPayments); }}
              style={{ width: '100%', padding: '1rem', background: '#ef4444', border: 'none', borderRadius: 10, color: '#fff', fontSize: '1.2rem', fontWeight: 800, cursor: 'pointer', letterSpacing: .5 }}
            >
              OK â€” Change Given âœ“
            </button>
          </div>
        </div>
      )}
      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 12, padding: '1.5rem', width: 420, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,.6)' }}>
        <h2 style={{ margin: '0 0 1rem', color: 'var(--sv-text-strong)', fontSize: '1.3rem' }}>
          {isLayby ? 'Layby Deposit' : 'Payment'}
          <span style={{ float: 'right', color: 'var(--sv-action)' }}>${fmt(total)}</span>
        </h2>

        {/* Method buttons */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginBottom: '1rem' }}>
          {methods.map(m => (
            <button key={m} onClick={() => { setActiveMethod(m); amountRef.current?.focus(); }}
              style={{ padding: '.5rem 1rem', borderRadius: 8, border: '1px solid', borderColor: m === activeMethod ? 'var(--sv-action)' : 'var(--sv-etch)', background: m === activeMethod ? 'rgba(37,99,235,.18)' : 'var(--sv-bg-2)', color: m === activeMethod ? 'var(--sv-action)' : 'var(--sv-text-main)', cursor: 'pointer', fontWeight: m === activeMethod ? 700 : 400 }}>
              {m}
            </button>
          ))}
        </div>

        {/* Amount input */}
        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem' }}>
          <input
            ref={amountRef}
            type='number' step='0.01' min='0'
            placeholder={`Amount (${fmt(remaining)} remaining)`}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addPayment(); }}
            style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
          />
          {activeMethod !== 'Cash' && (
            <input placeholder='Ref / Last 4' value={reference} onChange={e => setReference(e.target.value)} style={{ ...inputStyle, width: 110, marginBottom: 0 }} />
          )}
          <button onClick={addPayment} style={{ ...primaryBtn, padding: '.5rem 1rem', margin: 0 }}>Add</button>
        </div>

        {/* Quick amounts (Cash) */}
        {activeMethod === 'Cash' && (
          <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.75rem', flexWrap: 'wrap' }}>
            {[Math.ceil(remaining / 5) * 5, Math.ceil(remaining / 10) * 10, Math.ceil(remaining / 20) * 20, 50, 100].filter((v, i, a) => v >= remaining && a.indexOf(v) === i).slice(0, 4).map(v => (
              <button key={v} onClick={() => { setAmount(String(v)); amountRef.current?.focus(); }}
                style={{ padding: '.35rem .75rem', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 6, color: 'var(--sv-text-main)', cursor: 'pointer', fontSize: '.85rem' }}>
                ${v}
              </button>
            ))}
          </div>
        )}

        {/* Payments list */}
        {payments.length > 0 && (
          <div style={{ marginBottom: '.75rem' }}>
            {payments.map(p => (
              <div key={p.localId} style={{ display: 'flex', justifyContent: 'space-between', padding: '.3rem 0', fontSize: '.9rem', borderBottom: '1px solid var(--sv-etch)' }}>
                <span style={{ color: 'var(--sv-text-main)' }}>{p.method} {p.reference && <span style={{ color: 'var(--sv-text-dim)', fontSize: '.8rem' }}>({p.reference})</span>}</span>
                <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                  <span style={{ color: 'var(--sv-action)', fontWeight: 600 }}>${fmt(p.amount)}</span>
                  <button onClick={() => removePayment(p.localId)} style={{ background: 'transparent', border: 'none', color: 'var(--sv-red)', cursor: 'pointer' }}>Ã—</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Summary */}
        <div style={{ background: 'var(--sv-bg-0)', border: '1px solid var(--sv-etch)', borderRadius: 8, padding: '.75rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.25rem' }}>
            <span style={{ color: 'var(--sv-text-dim)' }}>Paid</span>
            <span style={{ color: 'var(--sv-mint)', fontWeight: 700 }}>${fmt(paid)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.25rem' }}>
            <span style={{ color: 'var(--sv-text-dim)' }}>Remaining</span>
            <span style={{ color: remaining > 0 ? 'var(--sv-red)' : 'var(--sv-mint)', fontWeight: 700 }}>${fmt(remaining)}</span>
          </div>
          {change > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '.5rem', paddingTop: '.5rem', borderTop: '1px solid var(--sv-etch)', fontSize: '1.1rem', fontWeight: 700 }}>
              <span style={{ color: 'var(--sv-amber)' }}>CHANGE</span>
              <span style={{ color: 'var(--sv-amber)' }}>${fmt(change)}</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '.75rem' }}>
          <button onClick={onCancel} style={{ ...smallBtn, flex: 1 }}>Cancel</button>
          <button
            onClick={() => onComplete(payments)}
            disabled={remaining > 0.001}
            style={{ flex: 2, padding: '.75rem', background: remaining <= 0.001 ? 'var(--sv-mint)' : 'var(--sv-bg-2)', border: 'none', borderRadius: 8, color: remaining <= 0.001 ? '#fff' : 'var(--sv-text-muted)', cursor: remaining <= 0.001 ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: '1rem' }}
          >
            {isLayby ? `Save Layby` : `Complete Sale`} âœ“
          </button>
        </div>
      </div>
    </div>
  );
}

// â”€â”€â”€ Parked Sales Screen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ParkedScreen({ sales, onRetrieve, onDelete, onBack }: {
  sales:      ParkedSale[];
  onRetrieve: (s: ParkedSale) => void;
  onDelete:   (localId: string) => void;
  onBack:     () => void;
}) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--sv-bg-0)', padding: '1.5rem', fontFamily: 'system-ui,sans-serif', color: 'var(--sv-text-main)' }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <button onClick={onBack} style={smallBtn}>â† Back to POS</button>
          <h1 style={{ margin: 0, color: 'var(--sv-text-strong)', fontSize: '1.3rem' }}>Parked Sales</h1>
        </div>
        {sales.length === 0 && <p style={{ color: 'var(--sv-text-muted)' }}>No parked sales.</p>}
        {sales.map(s => (
          <div key={s.local_id} style={{ background: 'var(--sv-bg-2)', borderRadius: 8, padding: '1rem', marginBottom: '.75rem', display: 'flex', alignItems: 'center', gap: '1rem', border: '1px solid var(--sv-etch)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: 'var(--sv-text-strong)' }}>{s.label}</div>
              {s.customer_name && <div style={{ fontSize: '.85rem', color: 'var(--sv-text-dim)' }}>{s.customer_name}</div>}
              <div style={{ fontSize: '.8rem', color: 'var(--sv-text-muted)' }}>{new Date(s.created_at).toLocaleString()} â€” {s.items.length} item(s)</div>
            </div>
            <span style={{ fontWeight: 700, color: 'var(--sv-action)', fontSize: '1.1rem' }}>${fmt(s.total)}</span>
            <button onClick={() => onRetrieve(s)} style={{ ...primaryBtn, padding: '.4rem .9rem' }}>Retrieve</button>
            <button onClick={() => onDelete(s.local_id)} style={{ ...smallBtn, color: 'var(--sv-red)', borderColor: 'var(--sv-red-border)' }}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// â”€â”€â”€ Receipt Screen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ReceiptPrintSettings {
  business_name: string;
  business_address: string;
  business_abn: string;
  pos_receipt_footer: string;
  gift_receipt_message?: string;
}

function ReceiptScreen({ sale, onClose, printSettings }: { sale: CompletedSale; onClose: () => void; printSettings?: ReceiptPrintSettings }) {
  const [printMode, setPrintMode] = useState<'normal' | 'gift'>('normal');

  const handlePrint = () => { setPrintMode('normal'); window.print(); };
  const handleGiftPrint = () => {
    setPrintMode('gift');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.addEventListener('afterprint', () => setPrintMode('normal'), { once: true });
      window.print();
    }));
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sv-bg-0)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: '2rem', paddingBottom: '2rem', fontFamily: 'system-ui,sans-serif', gap: '1.5rem' }}>
      <style>{printMode === 'gift' ? `
        @media print {
          body * { visibility: hidden !important; }
          .pos-gift-receipt-wrapper, .pos-gift-receipt-wrapper * { visibility: visible !important; }
          .pos-gift-receipt-wrapper { position: fixed !important; top: 0 !important; left: 0 !important; box-shadow: none !important; background: #fff !important; color: #000 !important; width: 80mm !important; padding: 4mm !important; border-radius: 0 !important; }
          .no-print { display: none !important; }
        }
      ` : `
        @media print {
          body * { visibility: hidden !important; }
          .pos-receipt-wrapper, .pos-receipt-wrapper * { visibility: visible !important; }
          .pos-receipt-wrapper { position: fixed !important; top: 0 !important; left: 0 !important; box-shadow: none !important; background: #fff !important; color: #000 !important; width: 80mm !important; padding: 4mm !important; border-radius: 0 !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start' }}>
        {/* Regular Receipt */}
        <div>
          <div className='no-print' style={{ textAlign: 'center', marginBottom: '.5rem', fontSize: '.72rem', color: 'var(--sv-text-dim)', fontFamily: 'system-ui,sans-serif', fontWeight: 600, letterSpacing: .6, textTransform: 'uppercase' }}>Receipt</div>
          <div className='pos-receipt-wrapper' style={{ background: '#fff', color: '#000', width: 300, padding: '1.5rem', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,.4)', fontFamily: 'monospace' }}>
            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>{printSettings?.business_name || 'Marketoir POS'}</div>
              {(printSettings?.business_address || sale.location_name) && (
                <div style={{ fontSize: '.8rem', color: '#555' }}>{printSettings?.business_address || sale.location_name}</div>
              )}
              {printSettings?.business_abn && (
                <div style={{ fontSize: '.8rem', color: '#555' }}>ABN: {printSettings.business_abn}</div>
              )}
              <br/>
              <div style={{ fontSize: '.8rem', color: '#555' }}>
                {new Date(sale.created_at).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' })}
              </div>
              <div style={{ fontSize: '.8rem', color: '#555' }}>Served by: {sale.cashier_name}</div>
              {sale.customer_name && <div style={{ fontSize: '.85rem', fontWeight: 600, marginTop: '.25rem' }}>{sale.customer_name}</div>}
              <div style={{ borderTop: '1px dashed #ccc', marginTop: '.5rem', paddingTop: '.5rem', fontSize: '.75rem', color: '#888' }}>
                {sale.id ? `#${sale.id}` : `local:${sale.local_id.slice(-8)}`} â€” {sale.sale_type.toUpperCase()}
              </div>
            </div>
            {/* Items */}
            <div style={{ marginBottom: '.75rem', fontSize: '.8rem' }}>
              {sale.items.map(i => (
                <div key={i.localId} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.2rem' }}>
                  <span style={{ flex: 1, paddingRight: '.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {i.qty}x {i.name}
                  </span>
                  <span>${fmt(i.line_total)}</span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px dashed #ccc', paddingTop: '.5rem', fontSize: '.85rem' }}>
              {sale.discount_total > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888' }}>
                  <span>Discount</span><span>-${fmt(sale.discount_total)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#555', fontSize: '.75rem' }}>
                <span>GST included</span><span>${fmt(sale.tax_total)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '1rem', marginTop: '.25rem' }}>
                <span>TOTAL</span><span>${fmt(sale.total)}</span>
              </div>
            </div>
            {/* Payments */}
            <div style={{ borderTop: '1px dashed #ccc', marginTop: '.5rem', paddingTop: '.5rem', fontSize: '.8rem' }}>
              {sale.payments.map(p => (
                <div key={p.localId} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{p.method}</span><span>${fmt(p.amount)}</span>
                </div>
              ))}
              {(() => {
                const paid = sale.payments.reduce((s, p) => s + p.amount, 0);
                const change = paid - sale.total;
                return change > 0.005 ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888' }}>
                    <span>Change</span><span>${fmt(change)}</span>
                  </div>
                ) : null;
              })()}
            </div>
            <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '.75rem', color: '#888', whiteSpace: 'pre-wrap' }}>
              {printSettings?.pos_receipt_footer || 'Thank you for your purchase!'}
            </div>
          </div>
          <div className='no-print' style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
            <button onClick={handlePrint} style={{ ...primaryBtn, padding: '.6rem 1.5rem' }}>ðŸ–¨ Print Receipt</button>
          </div>
        </div>

        {/* Gift Receipt */}
        <div>
          <div className='no-print' style={{ textAlign: 'center', marginBottom: '.5rem', fontSize: '.72rem', color: 'var(--sv-text-dim)', fontFamily: 'system-ui,sans-serif', fontWeight: 600, letterSpacing: .6, textTransform: 'uppercase' }}>Gift Receipt</div>
          <div className='pos-gift-receipt-wrapper' style={{ background: '#fff', color: '#000', width: 300, padding: '1.5rem', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,.4)', fontFamily: 'monospace' }}>
            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>{printSettings?.business_name || 'Marketoir POS'}</div>
              {(printSettings?.business_address || sale.location_name) && (
                <div style={{ fontSize: '.8rem', color: '#555' }}>{printSettings?.business_address || sale.location_name}</div>
              )}
              <div style={{ marginTop: '.5rem', fontSize: '.95rem', fontWeight: 700 }}>ðŸŽ Gift Receipt</div>
              <div style={{ fontSize: '.8rem', color: '#555' }}>
                {new Date(sale.created_at).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' })}
              </div>
            </div>
            {/* Items â€” no prices */}
            <div style={{ fontSize: '.85rem', borderTop: '1px dashed #ccc', paddingTop: '.75rem', marginBottom: '.75rem' }}>
              {sale.items.map(i => (
                <div key={i.localId} style={{ marginBottom: '.35rem' }}>
                  {Math.abs(i.qty)}Ã— {i.name}
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'center', marginTop: '.75rem', fontSize: '.8rem', color: '#666', borderTop: '1px dashed #ccc', paddingTop: '.75rem', whiteSpace: 'pre-wrap', fontStyle: 'italic' }}>
              {printSettings?.gift_receipt_message || 'We hope this gift brings you joy and happiness!'}
            </div>
          </div>
          <div className='no-print' style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
            <button onClick={handleGiftPrint} style={{ ...smallBtn, padding: '.6rem 1.5rem' }}>ðŸŽ Print Gift Receipt</button>
          </div>
        </div>
      </div>

      <div className='no-print'>
        <button onClick={onClose} style={{ ...smallBtn, padding: '.6rem 1.5rem' }}>New Sale</button>
      </div>
    </div>
  );
}

// â”€â”€â”€ EOD Screen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const AUD_DENOMS = [
  { label: '$100', value: 100 }, { label: '$50', value: 50 },
  { label: '$20', value: 20 },  { label: '$10', value: 10 },
  { label: '$5', value: 5 },    { label: '$2', value: 2 },
  { label: '$1', value: 1 },    { label: '50Â¢', value: 0.5 },
  { label: '20Â¢', value: 0.2 }, { label: '10Â¢', value: 0.1 },
  { label: '5Â¢', value: 0.05 },
];

type EodEntryState = { counted: string; openingFloat: string; denominations: Record<string, string>; notes: string; showDenom: boolean };

function calcCash(denoms: Record<string, string>): number {
  return AUD_DENOMS.reduce((sum, d) => sum + d.value * (parseFloat(denoms[String(d.value)] ?? '0') || 0), 0);
}

function EodScreen({ session, onBack }: { session: PosSession; onBack: () => void }) {
  const today = new Date().toLocaleDateString('sv-SE');
  const [mode, setMode]                   = useState<'open' | 'eod'>(() => new Date().getHours() < 12 ? 'open' : 'eod');
  const [date, setDate]                   = useState(today);
  const [expected, setExpected]           = useState<Record<string, number>>({});
  const [defaultFloat, setDefaultFloat]   = useState(200);
  const [openDenoms, setOpenDenoms]       = useState<Record<string, string>>({});
  const [entries, setEntries]             = useState<Record<string, EodEntryState>>({});
  const [loading, setLoading]             = useState(false);
  const [saved, setSaved]                 = useState(false);
  const [methods, setMethods]             = useState<string[]>([]);
  const [xeroInvoiceIds, setXeroInvoiceIds] = useState<Record<string, { id: string; number: string; syncedAt?: string }>>({});
  const [regSession, setRegSession]       = useState<any>(null);
  const [regSessionLoading, setRegSessionLoading] = useState(!!session.register_id);
  const [dayTotals, setDayTotals]         = useState<{ total_inc_tax: number; tax_total: number; total_exc_tax: number; sale_count: number } | null>(null);

  useEffect(() => {
    fetch('/api/pos/settings/payment-methods').then(r => r.json()).then(d => setMethods(d.methods ?? []));
    fetch('/api/pos/settings/float').then(r => r.json()).then(d => setDefaultFloat(d.amount ?? 200));
  }, []);

  const loadRegSession = () => {
    if (!session.register_id) { setRegSessionLoading(false); return; }
    setRegSessionLoading(true);
    fetch(`/api/pos/register/session?register_id=${session.register_id}`)
      .then(r => r.json())
      .then(d => setRegSession(d.session ?? null))
      .catch(() => {})
      .finally(() => setRegSessionLoading(false));
  };

  useEffect(() => { loadRegSession(); }, [session.register_id]);

  useEffect(() => {
    if (!methods.length) return;
    if (regSessionLoading) return;  // wait until we know whether a session exists
    setLoading(true);
    const sessionParam = regSession?.id ? `&register_session_id=${regSession.id}` : '';
    fetch(`/api/pos/eod?location_id=${session.location_id}&date=${date}${sessionParam}`)
      .then(r => r.json())
      .then(d => {
        setExpected(d.expected ?? {});
        setDayTotals(d.day_totals ?? null);
        const floatDefault: number = d.default_float ?? defaultFloat;
        const init: Record<string, EodEntryState> = {};
        for (const m of methods) {
          const rec = (d.reconciliations ?? []).find((r: any) => r.payment_method === m);
          init[m] = {
            counted:      rec?.counted_amount != null ? String(rec.counted_amount) : '',
            openingFloat: rec?.opening_float  != null ? String(rec.opening_float)  : (m === 'Cash' ? String(floatDefault) : '0'),
            denominations: rec?.denomination_data ?? {},
            notes:         rec?.notes ?? '',
            showDenom:     false,
          };
        }
        setEntries(init);
        // Restore xero sync state from DB
        const ids: Record<string, { id: string; number: string; syncedAt?: string }> = {};
        for (const rec of d.reconciliations ?? []) {
          if (rec.xero_invoice_id) ids[rec.payment_method] = { id: rec.xero_invoice_id, number: '', syncedAt: rec.xero_synced_at ?? undefined };
        }
        setXeroInvoiceIds(ids);
      })
      .finally(() => setLoading(false));
  }, [date, methods, session.location_id, regSession?.id, regSessionLoading]);

  function updateEntry(method: string, key: keyof EodEntryState, value: string | boolean | Record<string, string>) {
    setEntries(prev => {
      const updated = { ...prev[method], [key]: value };
      // When denominations are updated, sync the counted field to the calculated total
      if (key === 'denominations') {
        updated.counted = String(calcCash(value as Record<string, string>));
      }
      return { ...prev, [method]: updated };
    });
  }

  const openTotal = calcCash(openDenoms);
  const openVariance = openTotal - defaultFloat;

  async function saveOpenRegister() {
    setLoading(true);
    try {
      // 1. Record opening float in EOD
      await fetch('/api/pos/eod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location_id: session.location_id,
          date,
          entries: [{ payment_method: 'Cash', counted_amount: null, opening_float: openTotal, denomination_data: null, notes: null }],
        }),
      });
      // Update entries so EOD picks up the new opening float
      setEntries(prev => ({
        ...prev,
        Cash: { ...(prev.Cash ?? { counted: '', openingFloat: String(openTotal), denominations: {}, notes: '', showDenom: false }), openingFloat: String(openTotal) },
      }));

      // 2. Open register session (if register_id is set)
      if (session.register_id) {
        const openRes = await fetch('/api/pos/register/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            register_id:      session.register_id,
            location_id:      session.location_id,
            opening_float:    openTotal,
            denomination_data: Object.fromEntries(
              Object.entries(openDenoms).map(([k, v]) => [k, parseFloat(v) || 0]),
            ),
          }),
        });
        if (openRes.status === 409) {
          const errData = await openRes.json();
          alert(errData.error ?? 'Register is already open.');
          await loadRegSession();
          return;
        }
      }

      await loadRegSession();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setLoading(false);
    }
  }

  async function saveEod() {
    setLoading(true);
    const entriesArr = methods.map(m => {
      const e = entries[m] ?? {};
      const counted = parseFloat(e.counted ?? '0') || 0;
      return {
        payment_method:    m,
        counted_amount:    counted,
        opening_float:     parseFloat(e.openingFloat ?? '0') || null,
        denomination_data: m === 'Cash' ? Object.fromEntries(Object.entries(e.denominations ?? {}).map(([k, v]) => [k, parseFloat(v) || 0])) : null,
        notes:             e.notes || null,
      };
    });
    try {
      await fetch('/api/pos/eod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location_id: session.location_id,
          date: regSession?.session_date ?? date,
          register_session_id: regSession?.id ?? null,
          entries: entriesArr,
        }),
      });
      // Close the register session when EOD is saved
      if (session.register_id && regSession?.status === 'open' && regSession?.id) {
        await fetch('/api/pos/register/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: regSession.id }),
        });
        await loadRegSession();
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sv-bg-0)', padding: '1.5rem', fontFamily: 'system-ui,sans-serif', color: 'var(--sv-text-main)' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* â”€â”€ Header â”€â”€ */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <button onClick={onBack} style={smallBtn}>â† Back to POS</button>
          <h1 style={{ margin: 0, color: 'var(--sv-text-strong)', flex: 1, fontSize: '1.3rem' }}>
            {mode === 'open' ? 'Open Register' : 'End of Day Reconciliation'}
          </h1>
          {/* Mode tabs */}
          <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--sv-etch)' }}>
            <button onClick={() => setMode('open')} style={{ padding: '.35rem 1rem', background: mode === 'open' ? 'var(--sv-action)' : 'var(--sv-bg-2)', color: mode === 'open' ? '#fff' : 'var(--sv-text-dim)', border: 'none', cursor: 'pointer', fontSize: '.82rem', fontWeight: 700 }}>Open Register</button>
            <button onClick={() => setMode('eod')}  style={{ padding: '.35rem 1rem', background: mode === 'eod'  ? 'var(--sv-action)' : 'var(--sv-bg-2)', color: mode === 'eod'  ? '#fff' : 'var(--sv-text-dim)', border: 'none', cursor: 'pointer', fontSize: '.82rem', fontWeight: 700 }}>End of Day</button>
          </div>
          {mode === 'eod' && (
            <input type='date' value={date} onChange={e => setDate(e.target.value)} style={{ ...inputStyle, width: 160, marginBottom: 0 }} />
          )}
        </div>

        {loading && <p style={{ color: 'var(--sv-text-dim)' }}>Loadingâ€¦</p>}

        {/* â”€â”€ OPEN REGISTER â”€â”€ */}
        {mode === 'open' && !loading && (
          <div>
            {regSessionLoading ? (
              <p style={{ color: 'var(--sv-text-dim)' }}>Checking register statusâ€¦</p>
            ) : regSession?.status === 'open' ? (
              /* â”€â”€ Register is already open â”€â”€ */
              <div style={{ background: 'rgba(99,179,117,.08)', border: '1px solid var(--sv-mint)', borderRadius: 10, padding: '1.5rem', maxWidth: 500 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '1rem' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--sv-mint)', display: 'inline-block', boxShadow: '0 0 6px var(--sv-mint)' }} />
                  <span style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--sv-mint)' }}>Register is Open</span>
                </div>
                <div style={{ display: 'grid', gap: '.5rem', fontSize: '.9rem', color: 'var(--sv-text-main)', marginBottom: '1.25rem' }}>
                  {regSession.opened_at && <div><span style={{ color: 'var(--sv-text-dim)', width: 120, display: 'inline-block' }}>Opened at:</span> {new Date(regSession.opened_at).toLocaleString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, day: 'numeric', month: 'short' })}</div>}
                  {regSession.opened_by && <div><span style={{ color: 'var(--sv-text-dim)', width: 120, display: 'inline-block' }}>Opened by:</span> {regSession.opened_by}</div>}
                  {regSession.opening_float != null && <div><span style={{ color: 'var(--sv-text-dim)', width: 120, display: 'inline-block' }}>Opening float:</span> <strong>${fmt(Number(regSession.opening_float))}</strong></div>}
                </div>
                <p style={{ fontSize: '.82rem', color: 'var(--sv-text-dim)', margin: '0 0 1rem' }}>
                  To close this register and record end-of-day totals, use the <strong>End of Day</strong> tab.
                </p>
                <button onClick={() => setMode('eod')} style={{ ...primaryBtn, padding: '.5rem 1.25rem' }}>
                  Go to End of Day â†’
                </button>
              </div>
            ) : (
              /* â”€â”€ Register is closed â€” show open form â”€â”€ */
              <>
                {regSession?.status === 'closed' && (
                  <div style={{ background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 8, padding: '.75rem 1rem', marginBottom: '1.25rem', fontSize: '.82rem', color: 'var(--sv-text-dim)' }}>
                    Last session closed {regSession.closed_at ? new Date(regSession.closed_at).toLocaleString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, day: 'numeric', month: 'short' }) : 'today'}{regSession.closed_by ? ` by ${regSession.closed_by}` : ''}.
                  </div>
                )}
                {/* Summary cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '1rem 1.25rem' }}>
                    <div style={{ fontSize: '.72rem', color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: .8, marginBottom: 4 }}>Expected Float</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--sv-text-strong)' }}>${fmt(defaultFloat)}</div>
                  </div>
                  <div style={{ background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '1rem 1.25rem' }}>
                    <div style={{ fontSize: '.72rem', color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: .8, marginBottom: 4 }}>Counted Float</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--sv-text-strong)' }}>${fmt(openTotal)}</div>
                  </div>
                  <div style={{ background: openVariance === 0 ? 'var(--sv-mint-tint)' : 'var(--sv-red-tint)', border: `1px solid ${openVariance === 0 ? 'var(--sv-mint)' : 'var(--sv-red)'}`, borderRadius: 10, padding: '1rem 1.25rem' }}>
                    <div style={{ fontSize: '.72rem', color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: .8, marginBottom: 4 }}>Variance</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: openVariance >= 0 ? 'var(--sv-mint)' : 'var(--sv-red)' }}>
                      {openVariance >= 0 ? '+' : ''}{fmt(openVariance)}
                    </div>
                  </div>
                </div>

                {/* Denomination counter */}
                <div style={{ background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '1.25rem', marginBottom: '1.5rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--sv-text-strong)', marginBottom: '1rem', fontSize: '.95rem' }}>Count Opening Float</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(115px,1fr))', gap: '.6rem' }}>
                    {AUD_DENOMS.map(d => {
                      const count = parseFloat(openDenoms[String(d.value)] ?? '0') || 0;
                      return (
                        <label key={d.value} style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                          <span style={{ fontSize: '.72rem', color: 'var(--sv-text-dim)', fontWeight: 600 }}>
                            {d.label}{count > 0 ? ` Â· $${fmt(count * d.value)}` : ''}
                          </span>
                          <input
                            type='number' min='0' step='1'
                            value={openDenoms[String(d.value)] ?? ''}
                            onChange={ev => setOpenDenoms(prev => ({ ...prev, [String(d.value)]: ev.target.value }))}
                            style={{ ...inputStyle, marginBottom: 0, padding: '.3rem .5rem', fontSize: '.9rem' }}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <button onClick={saveOpenRegister} disabled={loading} style={{ ...primaryBtn, padding: '.65rem 2rem' }}>
                    {loading ? 'Savingâ€¦' : 'Open Register'}
                  </button>
                  {saved && <span style={{ color: 'var(--sv-mint)', fontWeight: 600 }}>âœ“ Register opened â€” float recorded</span>}
                </div>
              </>
            )}
          </div>
        )}

        {/* â”€â”€ END OF DAY â”€â”€ */}
        {mode === 'eod' && !loading && (
          <div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.9rem' }}>
                <thead>
                  <tr style={{ background: 'var(--sv-bg-2)', color: 'var(--sv-text-dim)', borderBottom: '2px solid var(--sv-etch)' }}>
                    <th style={thStyle}>Method</th>
                    <th style={thStyle}>Expected ($)</th>
                    <th style={thStyle}>Opening Float ($)</th>
                    <th style={thStyle}>Counted ($)</th>
                    <th style={thStyle}>Cash Sales</th>
                    <th style={thStyle}>Variance</th>
                    <th style={thStyle}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {methods.map(m => {
                    const e = entries[m] ?? { counted: '', openingFloat: '', denominations: {}, notes: '', showDenom: false };
                    const exp        = expected[m] ?? 0;
                    const counted    = parseFloat(e.counted ?? '') || 0;
                    const openFloat  = m === 'Cash' ? (parseFloat(e.openingFloat ?? '') || 0) : 0;
                    const cashSales  = m === 'Cash' ? counted - openFloat : null;
                    const variance   = m === 'Cash' ? (cashSales ?? 0) - exp : counted - exp;
                    return (
                      <>
                        <tr key={m} style={{ borderBottom: '1px solid var(--sv-etch)' }}>
                          <td style={tdStyle}>
                            <strong>{m}</strong>
                            {m === 'Cash' && (
                              <button onClick={() => updateEntry(m, 'showDenom', !e.showDenom)} style={{ marginLeft: '.5rem', fontSize: '.75rem', background: 'transparent', border: '1px solid var(--sv-etch)', color: 'var(--sv-text-dim)', borderRadius: 4, cursor: 'pointer', padding: '.1rem .3rem' }}>
                                {e.showDenom ? 'Hide' : 'Count'}
                              </button>
                            )}
                          </td>
                          <td style={{ ...tdStyle, color: 'var(--sv-action)', fontWeight: 600 }}>${fmt(exp)}</td>
                          <td style={tdStyle}>
                            {m === 'Cash' ? (
                              <input type='number' value={e.openingFloat} onChange={ev => updateEntry(m, 'openingFloat', ev.target.value)}
                                placeholder={String(defaultFloat)} style={{ ...inputStyle, width: 80, marginBottom: 0, padding: '.25rem .4rem', fontSize: '.85rem' }} />
                            ) : (
                              <span style={{ color: 'var(--sv-text-muted)' }}>â€”</span>
                            )}
                          </td>
                          <td style={tdStyle}>
                            <input type='number' value={e.counted} onChange={ev => updateEntry(m, 'counted', ev.target.value)}
                              placeholder='0.00' style={{ ...inputStyle, width: 90, marginBottom: 0, padding: '.25rem .4rem', fontSize: '.85rem' }} />
                          </td>
                          <td style={{ ...tdStyle, fontWeight: 600, color: 'var(--sv-text-strong)' }}>
                            {cashSales !== null ? `$${fmt(cashSales)}` : <span style={{ color: 'var(--sv-text-muted)' }}>â€”</span>}
                          </td>
                          <td style={{ ...tdStyle, color: variance >= 0 ? 'var(--sv-mint)' : 'var(--sv-red)', fontWeight: 600 }}>
                            {variance >= 0 ? '+' : ''}{fmt(variance)}
                          </td>
                          <td style={tdStyle}>
                            <input value={e.notes} onChange={ev => updateEntry(m, 'notes', ev.target.value)}
                              placeholder='notes' style={{ ...inputStyle, width: '100%', marginBottom: 0, padding: '.25rem .4rem', fontSize: '.8rem' }} />
                          </td>
                        </tr>
                        {m === 'Cash' && e.showDenom && (
                          <tr key={`${m}-denom`} style={{ background: 'var(--sv-bg-0)' }}>
                            <td colSpan={7} style={{ padding: '.75rem 1rem' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px,1fr))', gap: '.5rem' }}>
                                {AUD_DENOMS.map(d => (
                                  <label key={d.value} style={{ fontSize: '.8rem', color: 'var(--sv-text-dim)', display: 'flex', flexDirection: 'column', gap: '.15rem' }}>
                                    {d.label}
                                    <input type='number' min='0' step='1'
                                      value={e.denominations?.[String(d.value)] ?? ''}
                                      onChange={ev => {
                                        const newDenoms = { ...(e.denominations ?? {}), [String(d.value)]: ev.target.value };
                                        updateEntry(m, 'denominations', newDenoms);
                                      }}
                                      style={{ ...inputStyle, marginBottom: 0, padding: '.25rem .4rem', fontSize: '.85rem' }}
                                    />
                                  </label>
                                ))}
                              </div>
                              <div style={{ marginTop: '.5rem', fontWeight: 600, color: 'var(--sv-action)' }}>Cash total: ${fmt(calcCash(e.denominations ?? {}))}</div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <button onClick={saveEod} disabled={loading} style={{ ...primaryBtn, padding: '.65rem 2rem' }}>
                {loading ? 'Savingâ€¦' : 'Save EOD Reconciliation'}
              </button>
              {saved && <span style={{ color: 'var(--sv-mint)', fontWeight: 600 }}>âœ“ Saved</span>}
            </div>

            <EodAccountingSection
              session={session} methods={methods} expected={expected}
              entries={entries} defaultFloat={defaultFloat} date={date}
              xeroInvoiceIds={xeroInvoiceIds}
              dayTotals={dayTotals}
              onSynced={results => setXeroInvoiceIds(prev => {
                const next = { ...prev };
                const now = new Date().toISOString();
                for (const r of results) next[r.method] = { id: r.xeroId, number: r.invoiceNumber, syncedAt: now };
                return next;
              })}
            />
          </div>
        )}

      </div>
    </div>
  );
}

// ─── EOD Accounting Section ───────────────────────────────────────────────────────────────────────────

function EodAccountingSection({
  session, methods, expected, entries, defaultFloat, date, xeroInvoiceIds, dayTotals, onSynced,
}: {
  session:        PosSession;
  methods:        string[];
  expected:       Record<string, number>;
  entries:        Record<string, EodEntryState>;
  defaultFloat:   number;
  date:           string;
  xeroInvoiceIds: Record<string, { id: string; number: string; syncedAt?: string }>;
  dayTotals:      { total_inc_tax: number; tax_total: number; total_exc_tax: number; sale_count: number } | null;
  onSynced:       (results: { method: string; xeroId: string; invoiceNumber: string }[]) => void;
}) {
  const [open, setOpen]           = useState(false);
  const [syncing, setSyncing]     = useState(false);
  const [syncError, setSyncError] = useState('');

  const effectiveTaxRate = dayTotals && dayTotals.total_exc_tax > 0
    ? dayTotals.tax_total / dayTotals.total_exc_tax
    : 0.10;

  const rows = methods.map(m => {
    const e         = entries[m] ?? {} as EodEntryState;
    const counted   = parseFloat(e.counted ?? '') || 0;
    const openFloat = m === 'Cash' ? (parseFloat(e.openingFloat ?? '') || defaultFloat) : 0;
    const salesAmt  = m === 'Cash' ? counted - openFloat : counted;
    const exp       = expected[m] ?? 0;
    const variance  = salesAmt - exp;
    const synced    = xeroInvoiceIds[m] ?? null;
    const taxExc    = salesAmt / (1 + effectiveTaxRate);
    const gst       = salesAmt - taxExc;
    const taxInc    = salesAmt;
    return { method: m, salesAmt, exp, variance, synced, taxExc, gst, taxInc };
  });

  const totals    = rows.reduce((acc, r) => ({ sales: acc.sales + r.salesAmt, exp: acc.exp + r.exp }), { sales: 0, exp: 0 });
  const allSynced = rows.length > 0 && rows.every(r => r.synced);
  const anySynced = rows.some(r => r.synced);

  async function syncToXero() {
    setSyncing(true);
    setSyncError('');
    try {
      const res  = await fetch('/api/pos/xero/sync-eod', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ locationId: session.location_id, date }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Sync failed.');
      onSynced(data.results ?? []);
    } catch (e: any) {
      setSyncError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  function fmtDate(iso?: string) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso.slice(0, 16).replace('T', ' '); }
  }

  const thA: React.CSSProperties = { textAlign: 'left',  padding: '4px 8px', fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' };
  const tdA: React.CSSProperties = { padding: '7px 8px', fontSize: '.85rem', borderBottom: '1px solid var(--sv-etch)' };

  return (
    <div style={{ marginTop: '1.5rem', border: '1px solid var(--sv-etch)', borderRadius: 10, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', cursor: 'pointer', background: 'var(--sv-bg-2)', userSelect: 'none' }}>
        <span style={{ fontSize: '.88rem', fontWeight: 700, color: 'var(--sv-text-strong)' }}>🧮 Accounting</span>
        <div style={{ flex: 1 }} />
        {allSynced && <span style={{ fontSize: '.75rem', color: 'var(--sv-mint)', fontWeight: 600 }}>✓ Synced to Xero</span>}
        {anySynced && !allSynced && <span style={{ fontSize: '.75rem', color: 'var(--sv-amber)', fontWeight: 600 }}>⚠ Partially synced</span>}
        <span style={{ color: 'var(--sv-text-dim)', fontSize: 13 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '1rem 1.25rem', background: 'var(--sv-bg-1)' }}>

          {/* Summary table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.25rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--sv-etch)' }}>
                <th style={thA}>Method</th>
                <th style={{ ...thA, textAlign: 'right' }}>Ex-Tax</th>
                <th style={{ ...thA, textAlign: 'right' }}>GST</th>
                <th style={{ ...thA, textAlign: 'right' }}>Total (inc tax)</th>
                <th style={{ ...thA, textAlign: 'right' }}>POS Expected</th>
                <th style={{ ...thA, textAlign: 'right' }}>Variance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.method}>
                  <td style={{ ...tdA, fontWeight: 600 }}>{r.method}</td>
                  <td style={{ ...tdA, textAlign: 'right', fontWeight: 600 }}>${fmt(r.taxExc)}</td>
                  <td style={{ ...tdA, textAlign: 'right', color: 'var(--sv-text-dim)' }}>${fmt(r.gst)}</td>
                  <td style={{ ...tdA, textAlign: 'right' }}>${fmt(r.taxInc)}</td>
                  <td style={{ ...tdA, textAlign: 'right', color: 'var(--sv-text-dim)' }}>${fmt(r.exp)}</td>
                  <td style={{ ...tdA, textAlign: 'right', fontWeight: 600, color: r.variance >= 0 ? 'var(--sv-mint)' : 'var(--sv-red)' }}>
                    {r.variance >= 0 ? '+' : ''}{fmt(r.variance)}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--sv-etch)', fontWeight: 700, background: 'var(--sv-bg-0)' }}>
                <td style={{ ...tdA, borderBottom: 'none' }}>Total</td>
                <td style={{ ...tdA, textAlign: 'right', color: 'var(--sv-action)', borderBottom: 'none' }}>
                  ${fmt(dayTotals ? dayTotals.total_exc_tax : totals.sales / (1 + effectiveTaxRate))}
                </td>
                <td style={{ ...tdA, textAlign: 'right', color: 'var(--sv-action)', borderBottom: 'none' }}>
                  ${fmt(dayTotals ? dayTotals.tax_total : totals.sales - totals.sales / (1 + effectiveTaxRate))}
                </td>
                <td style={{ ...tdA, textAlign: 'right', color: 'var(--sv-action)', borderBottom: 'none' }}>
                  ${fmt(dayTotals ? dayTotals.total_inc_tax : totals.sales)}
                </td>
                <td style={{ ...tdA, borderBottom: 'none' }} />
                <td style={{ ...tdA, borderBottom: 'none' }} />
              </tr>
            </tbody>
          </table>

          {/* Per-method Xero entries */}
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
              Xero Entries
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rows.map(r => (
                <div key={r.method} style={{
                  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
                  padding: '10px 14px', borderRadius: 8,
                  border: `1px solid ${r.synced ? 'rgba(16,185,129,.25)' : 'var(--sv-etch)'}`,
                  background: r.synced ? 'rgba(16,185,129,.04)' : 'var(--sv-bg-0)',
                }}>
                  <span style={{ minWidth: 64, fontWeight: 700, fontSize: '.88rem' }}>{r.method}</span>

                  {r.synced ? (
                    <>
                      <span style={{ fontSize: '.75rem', fontWeight: 700, color: '#34d399', background: 'rgba(16,185,129,.13)', borderRadius: 99, padding: '2px 9px', whiteSpace: 'nowrap' }}>
                        ✓ Synced to Xero
                      </span>
                      {r.synced.number ? (
                        <a href={`https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${r.synced.id}`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ color: '#34d399', fontSize: '.82rem', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                          {r.synced.number} ↗
                        </a>
                      ) : (
                        <a href={`https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${r.synced.id}`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ color: '#34d399', fontSize: '.78rem', textDecoration: 'none', opacity: .8 }}>
                          View ↗
                        </a>
                      )}
                      {r.synced.syncedAt && (
                        <span style={{ fontSize: '.75rem', color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>
                          {fmtDate(r.synced.syncedAt)}
                        </span>
                      )}
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, fontSize: '.82rem', flexWrap: 'wrap' }}>
                        <span>
                          <span style={{ color: 'var(--sv-text-dim)' }}>POS Expected: </span>
                          <strong>${fmt(r.exp)}</strong>
                        </span>
                        <span>
                          <span style={{ color: 'var(--sv-text-dim)' }}>Sent to Xero: </span>
                          <strong style={{ color: '#34d399' }}>${fmt(r.taxInc)}</strong>
                        </span>
                        {Math.abs(r.taxInc - r.exp) > 0.005 && (
                          <span style={{ color: '#f87171', fontWeight: 700, fontSize: '.78rem' }}>
                            ⚠ Mismatch: {r.taxInc > r.exp ? '+' : ''}{fmt(r.taxInc - r.exp)}
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: '.75rem', color: 'var(--sv-text-dim)', background: 'var(--sv-bg-2)', borderRadius: 99, padding: '2px 9px', border: '1px solid var(--sv-etch)', whiteSpace: 'nowrap' }}>
                        ○ Not synced
                      </span>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, fontSize: '.82rem', flexWrap: 'wrap' }}>
                        <span>
                          <span style={{ color: 'var(--sv-text-dim)' }}>POS Expected: </span>
                          <strong>${fmt(r.exp)}</strong>
                        </span>
                        <span>
                          <span style={{ color: 'var(--sv-text-dim)' }}>Would send: </span>
                          <strong style={{ color: 'var(--sv-text-dim)' }}>${fmt(r.taxInc)}</strong>
                        </span>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ fontSize: '.75rem', color: 'var(--sv-text-dim)', marginBottom: '1rem', lineHeight: 1.7 }}>
            <strong>What is sent to Xero:</strong> One ACCREC invoice (AUTHORISED) per payment method
            &nbsp;· Contact: <em>POS Reconciliation (Summary)</em>
            &nbsp;· Reference: EOD-L{session.location_id}-{date}-{'{Method}'}<br />
            Amount sent = Tax-Inc Total (Inclusive tax treatment) — Xero extracts the GST automatically<br />
            Cash = Counted − Opening Float &nbsp;· Other methods = Counted amount
            &nbsp;· Auto-synced on EOD save when admin session is active
          </div>

          {syncError && <div style={{ color: 'var(--sv-red)', fontSize: '.8rem', marginBottom: '.75rem' }}>{syncError}</div>}

          <button onClick={syncToXero} disabled={syncing}
            style={{ ...primaryBtn, padding: '.5rem 1.5rem', fontSize: '.85rem' }}>
            {syncing ? 'Syncing…' : allSynced ? 'Re-sync to Xero' : 'Sync to Xero'}
          </button>
        </div>
      )}
    </div>
  );
}


// ΓöÇΓöÇΓöÇ Receive Transfers Screen ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function ReceiveTransfersScreen({ session, onBack }: { session: PosSession; onBack: () => void }) {
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [activeBt, setActiveBt]   = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ims/branch-transfers?status=sent`).then(r => r.json());
      const all: any[] = res.data ?? [];
      setTransfers(all.filter((bt: any) => Number(bt.to_location_id) === session.location_id));
    } catch {}
    setLoading(false);
  }, [session.location_id]);

  useEffect(() => { load(); }, [load]);

  const openReceive = async (bt: any) => {
    const res = await fetch(`/api/ims/branch-transfers/${bt.id}`).then(r => r.json());
    setActiveBt(res.data);
  };

  if (activeBt) return (
    <ReceiveBtInline
      bt={activeBt}
      onBack={() => setActiveBt(null)}
      onDone={() => { setActiveBt(null); load(); }}
    />
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sv-bg-0)', padding: '1.5rem', fontFamily: 'system-ui,sans-serif', color: 'var(--sv-text-main)' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <button onClick={onBack} style={smallBtn}>ΓåÉ Back to POS</button>
          <h1 style={{ margin: 0, color: 'var(--sv-text-strong)', flex: 1, fontSize: '1.3rem' }}>≡ƒôª Receive Branch Transfers ΓÇö {session.location_name}</h1>
          <button onClick={load} style={smallBtn}>Γå╗ Refresh</button>
        </div>

        {loading ? (
          <p style={{ color: 'var(--sv-text-dim)' }}>LoadingΓÇª</p>
        ) : transfers.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--sv-text-dim)', background: 'var(--sv-bg-1)', borderRadius: 10, border: '1px solid var(--sv-etch)' }}>
            No transfers currently awaiting receipt at {session.location_name}.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {transfers.map((bt: any) => (
              <div key={bt.id} style={{ background: 'var(--sv-bg-2)', borderRadius: 10, border: '1px solid var(--sv-etch)', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--sv-text-strong)', marginBottom: 2 }}>{bt.transfer_number}</div>
                  <div style={{ fontSize: '.85rem', color: 'var(--sv-text-dim)' }}>From: <strong style={{ color: 'var(--sv-text-main)' }}>{bt.from_location_name}</strong> ┬╖ Date: {bt.transfer_date?.slice(0,10)} ┬╖ Value: ${Number(bt.total_value).toFixed(2)}</div>
                </div>
                <button
                  onClick={() => openReceive(bt)}
                  style={{ padding: '.55rem 1.2rem', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--sv-mint,#0c9)', color: '#fff', fontWeight: 700, fontSize: '.9rem', whiteSpace: 'nowrap' }}
                >
                  Receive
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReceiveBtInline({ bt, onBack, onDone }: { bt: any; onBack: () => void; onDone: () => void }) {
  const [receiveQtys, setReceiveQtys] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    for (const item of bt.items ?? []) init[item.id] = 0;
    return init;
  });
  const [scanInput, setScanInput]     = useState('');
  const [lastScanned, setLastScanned] = useState<any | null>(null);
  const [scanError, setScanError]     = useState<string | null>(null);
  const [submitting, setSubmitting]   = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const playError = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'square'; osc.frequency.value = 200;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.start(); osc.stop(ctx.currentTime + 0.45);
    } catch {}
  };

  const handleScan = (value: string) => {
    const trimmed = value.trim();
    setScanInput('');
    if (!trimmed) return;
    const match = (bt.items ?? []).find((i: any) =>
      (i.barcode && i.barcode === trimmed) || (i.sku && i.sku === trimmed)
    );
    if (!match) {
      playError();
      setScanError(`No item matched "${trimmed}"`);
      setLastScanned(null);
      setTimeout(() => setScanError(null), 5000);
      scanRef.current?.focus();
      return;
    }
    setScanError(null);
    setReceiveQtys(prev => ({ ...prev, [match.id]: (prev[match.id] ?? 0) + 1 }));
    setLastScanned(match);
    scanRef.current?.focus();
  };

  const handleReceiveAll = () => {
    const all: Record<number, number> = {};
    for (const item of bt.items ?? []) all[item.id] = Number(item.qty_sent);
    setReceiveQtys(all);
  };

  const handleSubmit = async () => {
    const items: any[] = bt.items ?? [];
    const notReceived     = items.filter((i: any) => (receiveQtys[i.id] ?? 0) === 0);
    const partialReceived = items.filter((i: any) => { const r = receiveQtys[i.id] ?? 0; return r > 0 && r < Number(i.qty_sent); });
    if (notReceived.length > 0 || partialReceived.length > 0) {
      const lines: string[] = [];
      if (notReceived.length > 0) {
        lines.push(`Not received (stock stays at ${bt.from_location_name}):`);
        notReceived.forEach((i: any) => lines.push(`  ΓÇó ${i.sku || i.product_name}${i.variant_label ? ` ΓÇö ${i.variant_label}` : ''} (sent: ${Number(i.qty_sent)})`));
      }
      if (partialReceived.length > 0) {
        lines.push('');
        lines.push('Partially received (remainder stays at source):');
        partialReceived.forEach((i: any) => {
          const r = receiveQtys[i.id] ?? 0;
          lines.push(`  ΓÇó ${i.sku || i.product_name}${i.variant_label ? ` ΓÇö ${i.variant_label}` : ''} (sent: ${Number(i.qty_sent)}, receiving: ${r})`);
        });
      }
      lines.push('');
      lines.push(`Proceed? Only received quantities will be moved to ${bt.to_location_name}.`);
      if (!confirm(lines.join('\n'))) return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/ims/branch-transfers/${bt.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'received',
          receivedItems: Object.entries(receiveQtys).map(([id, qty]) => ({ item_id: Number(id), qty_received: qty })),
        }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error ?? 'Failed'); return; }
      onDone();
    } catch (e: any) { alert(e.message); }
    finally { setSubmitting(false); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sv-bg-0)', padding: '1.5rem', fontFamily: 'system-ui,sans-serif', color: 'var(--sv-text-main)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
          <button onClick={onBack} style={smallBtn}>ΓåÉ Back</button>
          <h1 style={{ margin: 0, color: 'var(--sv-text-strong)', flex: 1, fontSize: '1.2rem' }}>
            ≡ƒôª {bt.transfer_number} ΓÇö from {bt.from_location_name}
          </h1>
          <button onClick={handleReceiveAll} style={{ ...smallBtn, color: 'var(--sv-text-main)' }}>Receive All</button>
          <button onClick={handleSubmit} disabled={submitting} style={{ padding: '.55rem 1.4rem', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--sv-mint,#0c9)', color: '#fff', fontWeight: 700, fontSize: '.9rem', opacity: submitting ? .6 : 1 }}>
            {submitting ? 'ProcessingΓÇª' : 'Confirm Receipt & Move Stock'}
          </button>
        </div>

        {/* Scan section */}
        <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: 700, fontSize: '.95rem', marginBottom: '.7rem', color: 'var(--sv-text-strong)' }}>≡ƒô╖ Receive by Scanning Items</div>
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.6rem' }}>
            <input
              ref={scanRef}
              type="text"
              placeholder="Scan barcode or type SKU, press EnterΓÇª"
              value={scanInput}
              onChange={e => setScanInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleScan(scanInput); } }}
              autoFocus
              style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', fontSize: '1rem', marginBottom: 0 }}
            />
            <button onClick={() => handleScan(scanInput)} style={{ padding: '.5rem 1.1rem', borderRadius: 7, border: 'none', cursor: 'pointer', background: 'var(--sv-action)', color: '#fff', fontWeight: 600 }}>Scan</button>
          </div>
          {scanError && (
            <div style={{ padding: '.55rem .9rem', background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.4)', borderRadius: 7, fontSize: '.87rem', color: '#f87171', marginBottom: '.6rem' }}>ΓÜá {scanError}</div>
          )}
          {lastScanned ? (
            <div style={{ padding: '.75rem 1rem', background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 8 }}>
              <div style={{ fontSize: '.75rem', color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }}>Last Scanned</div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--sv-text-strong)', marginBottom: 5 }}>
                {lastScanned.product_name}{lastScanned.variant_label ? ` ΓÇö ${lastScanned.variant_label}` : ''}
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', fontSize: '.9rem', flexWrap: 'wrap' }}>
                <span><span style={{ color: 'var(--sv-text-dim)' }}>RRP: </span><strong style={{ color: '#34d399', fontSize: '1rem' }}>{lastScanned.price_rrp ? `$${Number(lastScanned.price_rrp).toFixed(2)}` : 'ΓÇö'}</strong></span>
                <span><span style={{ color: 'var(--sv-text-dim)' }}>Sent: </span><strong>{Number(lastScanned.qty_sent)}</strong></span>
                <span><span style={{ color: 'var(--sv-text-dim)' }}>Received: </span><strong style={{ color: '#34d399' }}>{receiveQtys[lastScanned.id] ?? 0}</strong></span>
                <span><span style={{ color: 'var(--sv-text-dim)' }}>Awaiting: </span>
                  <strong style={{ color: Math.max(0, Number(lastScanned.qty_sent) - (receiveQtys[lastScanned.id] ?? 0)) > 0 ? '#fbbf24' : '#34d399' }}>
                    {Math.max(0, Number(lastScanned.qty_sent) - (receiveQtys[lastScanned.id] ?? 0))}
                  </strong>
                </span>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '.83rem', color: 'var(--sv-text-dim)' }}>Scan an item to see its details here.</div>
          )}
        </div>

        {/* Items table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--sv-bg-1)', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--sv-etch)' }}>
          <thead>
            <tr style={{ background: 'var(--sv-bg-2)' }}>
              {['SKU', 'Product / Variant', 'RRP', 'Qty Sent', 'Qty Received', 'Awaiting'].map(h => (
                <th key={h} style={{ padding: '.6rem .9rem', textAlign: 'left', fontSize: '.75rem', color: 'var(--sv-text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(bt.items ?? []).map((item: any) => {
              const rcvd = receiveQtys[item.id] ?? 0;
              const awaiting = Math.max(0, Number(item.qty_sent) - rcvd);
              const isLast = lastScanned?.id === item.id;
              return (
                <tr key={item.id} style={{ borderTop: '1px solid var(--sv-etch)', background: isLast ? 'rgba(16,185,129,.07)' : 'transparent' }}>
                  <td style={{ padding: '.6rem .9rem', fontFamily: 'monospace', fontSize: '.82rem', color: 'var(--sv-mint,#0c9)' }}>{item.sku || 'ΓÇö'}</td>
                  <td style={{ padding: '.6rem .9rem' }}>
                    <div style={{ fontSize: '.9rem' }}>{item.product_name}</div>
                    {item.variant_label && <div style={{ fontSize: '.78rem', color: 'var(--sv-text-dim)' }}>{item.variant_label}</div>}
                  </td>
                  <td style={{ padding: '.6rem .9rem', fontSize: '.9rem', color: 'var(--sv-text-dim)' }}>{item.price_rrp ? `$${Number(item.price_rrp).toFixed(2)}` : 'ΓÇö'}</td>
                  <td style={{ padding: '.6rem .9rem', fontSize: '.9rem', color: 'var(--sv-text-dim)' }}>{Number(item.qty_sent)}</td>
                  <td style={{ padding: '.4rem .9rem', width: 100 }}>
                    <input
                      type="number" min="0" step="1"
                      value={rcvd}
                      onChange={e => setReceiveQtys(p => ({ ...p, [item.id]: Number(e.target.value) }))}
                      style={{ ...inputStyle, marginBottom: 0, fontSize: '.9rem', borderColor: isLast ? '#34d399' : rcvd !== Number(item.qty_sent) && rcvd > 0 ? '#f87171' : undefined }}
                    />
                  </td>
                  <td style={{ padding: '.6rem .9rem', fontSize: '.9rem', fontWeight: 600, color: awaiting > 0 ? '#fbbf24' : '#34d399' }}>
                    {awaiting > 0 ? awaiting : 'Γ£ô'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ΓöÇΓöÇΓöÇ Reports Screen ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function ReportsScreen({ session, onBack }: { session: PosSession; onBack: () => void }) {
  const today = new Date().toLocaleDateString('sv-SE');
  const [date, setDate] = useState(today);
  const [data, setData] = useState<any>(null);
  const [graphData, setGraphData] = useState<{ date: string; total: number; count: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/pos/reports/daily?location_id=${session.location_id}&date=${date}`).then(r => r.json()),
      fetch(`/api/pos/reports/graph?location_id=${session.location_id}&days=30`).then(r => r.json()),
    ]).then(([daily, graph]) => {
      setData(daily);
      setGraphData(graph.data ?? []);
    }).finally(() => setLoading(false));
  }, [date, session.location_id]);

  const maxTotal = Math.max(...graphData.map(d => d.total), 1);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sv-bg-0)', padding: '1.5rem', fontFamily: 'system-ui,sans-serif', color: 'var(--sv-text-main)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <button onClick={onBack} style={smallBtn}>ΓåÉ Back to POS</button>
          <h1 style={{ margin: 0, color: 'var(--sv-text-strong)', flex: 1, fontSize: '1.3rem' }}>Reports</h1>
          <input type='date' value={date} onChange={e => setDate(e.target.value)} style={{ ...inputStyle, width: 160, marginBottom: 0 }} />
        </div>

        {/* 30-day bar chart */}
        {graphData.length > 0 && (
          <div style={{ background: 'var(--sv-bg-2)', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem', border: '1px solid var(--sv-etch)' }}>
            <h3 style={{ margin: '0 0 1rem', color: 'var(--sv-text-strong)', fontSize: '.95rem' }}>Daily Revenue ΓÇö Last 30 Days</h3>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 80, overflowX: 'auto' }}>
              {graphData.map(d => (
                <div key={d.date} title={`${d.date}: $${fmt(d.total)} (${d.count} sale${d.count !== 1 ? 's' : ''})`}
                  style={{ flex: '0 0 auto', width: 20, height: `${(d.total / maxTotal) * 80}px`, minHeight: 2, background: d.date === date ? 'var(--sv-amber)' : 'var(--sv-action)', borderRadius: '3px 3px 0 0', cursor: 'default' }} />
              ))}
            </div>
          </div>
        )}

        {loading && <p style={{ color: 'var(--sv-text-dim)' }}>LoadingΓÇª</p>}

        {data && (
          <>
            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              <StatCard label='Total Revenue' value={`$${fmt(data.summary?.total_revenue ?? 0)}`} />
              <StatCard label='Transactions' value={String(data.summary?.total_count ?? 0)} />
              {Object.entries(data.summary?.by_method ?? {}).map(([m, v]) => (
                <StatCard key={m} label={m} value={`$${fmt(v as number)}`} />
              ))}
            </div>

            {/* Transactions */}
            {data.transactions?.length === 0 && <p style={{ color: 'var(--sv-text-muted)' }}>No completed transactions for this date.</p>}
            {data.transactions?.map((t: any, idx: number) => (
              <div key={t.sale.id ?? idx} style={{ background: 'var(--sv-bg-2)', borderRadius: 8, marginBottom: '.75rem', border: '1px solid var(--sv-etch)', overflow: 'hidden' }}>
                <div
                  onClick={() => setExpanded(expanded === idx ? null : idx)}
                  style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '.75rem 1rem', cursor: 'pointer' }}
                >
                  <span style={{ color: 'var(--sv-text-dim)', fontSize: '.85rem' }}>{new Date(t.sale.created_at).toLocaleTimeString('en-AU', { timeStyle: 'short' })}</span>
                  <span style={{ flex: 1, fontSize: '.9rem', color: 'var(--sv-text-main)' }}>{t.sale.customer_name ?? 'ΓÇö'} <span style={{ color: 'var(--sv-text-dim)', fontSize: '.8rem' }}>({t.items.length} item{t.items.length !== 1 ? 's' : ''})</span></span>
                  <span style={{ color: t.sale.sale_type === 'return' ? 'var(--sv-red)' : 'var(--sv-mint)', fontWeight: 700 }}>
                    {t.sale.sale_type === 'return' ? '-' : ''}${fmt(t.sale.total)}
                  </span>
                  <span style={{ fontSize: '.8rem', color: 'var(--sv-text-muted)' }}>{expanded === idx ? 'Γû▓' : 'Γû╝'}</span>
                </div>
                {expanded === idx && (
                  <div style={{ borderTop: '1px solid var(--sv-etch)', padding: '.75rem 1rem', fontSize: '.85rem' }}>
                    {t.items.map((item: any) => (
                      <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '.2rem 0', borderBottom: '1px solid var(--sv-etch)' }}>
                        <span style={{ color: 'var(--sv-text-main)' }}>{item.qty}├ù {item.name}</span>
                        <span style={{ color: 'var(--sv-action)', fontWeight: 600 }}>${fmt(item.line_total)}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: '.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      {t.payments.map((p: any) => (
                        <span key={p.id} style={{ background: 'var(--sv-bg-0)', border: '1px solid var(--sv-etch)', borderRadius: 4, padding: '.2rem .5rem', fontSize: '.8rem', color: 'var(--sv-text-dim)' }}>{p.payment_method}: ${fmt(p.amount)}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--sv-bg-2)', borderRadius: 8, padding: '1rem', border: '1px solid var(--sv-etch)' }}>
      <div style={{ color: 'var(--sv-text-dim)', fontSize: '.8rem', marginBottom: '.25rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: '1.3rem', color: 'var(--sv-text-strong)' }}>{value}</div>
    </div>
  );
}

// ΓöÇΓöÇΓöÇ Shared styles ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '.5rem .65rem',
  background: 'var(--sv-bg-0)',
  border: '1px solid var(--sv-etch)',
  borderRadius: 8,
  color: 'var(--sv-text-main)',
  fontSize: '.9rem',
  outline: 'none',
  marginBottom: '.75rem',
  boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '.8rem',
  color: 'var(--sv-text-dim)',
  marginBottom: '.3rem',
};
const primaryBtn: React.CSSProperties = {
  background: 'var(--sv-action)',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '.6rem 1rem',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '.9rem',
};
const smallBtn: React.CSSProperties = {
  background: 'var(--sv-bg-2)',
  color: 'var(--sv-text-main)',
  border: '1px solid var(--sv-etch)',
  borderRadius: 6,
  padding: '.45rem .9rem',
  cursor: 'pointer',
  fontSize: '.92rem',
  fontWeight: 700,
  whiteSpace: 'nowrap' as const,
};
const qtyBtn: React.CSSProperties = {
  width: 26,
  height: 26,
  background: 'var(--sv-bg-2)',
  border: '1px solid var(--sv-etch)',
  borderRadius: 5,
  color: 'var(--sv-text-main)',
  cursor: 'pointer',
  fontSize: '.9rem',
  lineHeight: 1,
  flexShrink: 0,
};
const thStyle: React.CSSProperties = {
  padding: '.6rem .75rem',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: '.75rem',
  textTransform: 'uppercase',
  letterSpacing: '.06em',
  color: 'var(--sv-text-dim)',
};
const tdStyle: React.CSSProperties = {
  padding: '.6rem .75rem',
  verticalAlign: 'middle',
  color: 'var(--sv-text-main)',
};

// ΓöÇΓöÇΓöÇ POS Help Modal ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

type PosHelpSection = 'overview' | 'register' | 'offline' | 'pin';

function PosHelpModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [active, setActive] = useState<PosHelpSection>('overview');
  useEffect(() => { if (isOpen) setActive('overview'); }, [isOpen]);
  if (!isOpen) return null;

  const NAV_ITEMS: { id: PosHelpSection; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview',          icon: '≡ƒ¢Æ' },
    { id: 'register', label: 'Register Sessions', icon: '≡ƒùé' },
    { id: 'offline',  label: 'Offline & Queue',   icon: '≡ƒô╢' },
    { id: 'pin',      label: 'PIN Security',      icon: '≡ƒöÆ' },
  ];

  const h2: React.CSSProperties   = { margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: 'var(--sv-text-strong)' };
  const h3: React.CSSProperties   = { margin: '24px 0 6px', fontSize: 14, fontWeight: 700, color: 'var(--sv-text-strong)', borderBottom: '1px solid var(--sv-etch)', paddingBottom: 6 };
  const p: React.CSSProperties    = { margin: '6px 0 10px', fontSize: 13, color: 'var(--sv-text-dim)', lineHeight: 1.65 };
  const ul: React.CSSProperties   = { margin: '6px 0 10px', paddingLeft: 20, fontSize: 13, color: 'var(--sv-text-dim)', lineHeight: 1.75 };

  const Content = () => {
    if (active === 'overview') return (
      <div style={{ padding: 32, maxWidth: 760 }}>
        <h2 style={h2}>Point of Sale</h2>
        <p style={{ ...p, marginBottom: 16 }}>The Marketoir POS lets you ring up sales, process returns, manage layby, and reconcile your daily cash takings.</p>
        <h3 style={h3}>Getting started</h3>
        <ul style={ul}>
          <li><strong>Device setup</strong> ΓÇö Each device is tied to a specific location and register. Setup is done once; the device remembers its configuration.</li>
          <li><strong>Staff login</strong> ΓÇö Operators log in with a short numeric PIN. An admin fallback (email + password) is also available.</li>
          <li><strong>Product panel</strong> ΓÇö Products are loaded at login and cached on-device. Use the search bar or browse the grid. Barcode scanners work automatically.</li>
          <li><strong>Cart</strong> ΓÇö Add products, adjust quantities, apply line-level discounts or price overrides, then charge to complete the sale.</li>
          <li><strong>Payment types</strong> ΓÇö Cash, card, or any method configured in IMS Settings ΓåÆ Point of Sale. Split payments across multiple methods are supported.</li>
        </ul>
        <h3 style={h3}>Sale types</h3>
        <ul style={ul}>
          <li><strong>Sale</strong> ΓÇö Standard completed transaction. Stock is deducted immediately.</li>
          <li><strong>Return / Refund</strong> ΓÇö Toggle "Return Mode" in the header. Negative quantities reverse stock and post a negative POS sale.</li>
          <li><strong>Layby</strong> ΓÇö Toggle "Layby" in the header. Recorded as a pending sale; no stock movement until fulfilled.</li>
          <li><strong>Park Sale</strong> ΓÇö Save a cart with a label to resume later (same device only). Parked sales do not commit stock and are lost if the browser is cleared.</li>
        </ul>
        <h3 style={h3}>Daily Xero batch</h3>
        <p style={p}>POS sales are not individually synced to Xero. Instead, a single summary invoice is created per location per day from the <strong>Register ΓåÆ EOD</strong> screen.</p>
      </div>
    );
    if (active === 'register') return (
      <div style={{ padding: 32, maxWidth: 760 }}>
        <h2 style={h2}>Register Sessions</h2>
        <p style={p}>A <strong>register session</strong> is one continuous period that a till is open ΓÇö from the moment a cashier opens the register (entering the opening float) to the moment it is closed at end of day. Every sale is stamped with the session it was rung up in, not just the calendar date.</p>
        <h3 style={h3}>Opening a session</h3>
        <p style={p}>On first login of the day go to <strong>Register</strong> and open the register, counting the starting float by denomination. This establishes the session.</p>
        <h3 style={h3}>Closing a session (EOD)</h3>
        <p style={p}>At end of day go to <strong>Register ΓåÆ EOD</strong>. Count the drawer and the system reconciles <em>expected</em> vs <em>counted</em> takings per payment method, then marks the session closed. The Xero batch button also lives here.</p>
        <h3 style={h3}>Reconciling by session window</h3>
        <p style={p}>Takings are summed over the <strong>session window</strong> (all sales in the openΓåÆclose session), not just "all sales dated today". This handles two common situations:</p>
        <ul style={ul}>
          <li><strong>Trading past midnight</strong> ΓÇö A sale rung after midnight stays with its session&apos;s date, not the next calendar day.</li>
          <li><strong>Register left open overnight</strong> ΓÇö Yesterday&apos;s session won&apos;t silently absorb today&apos;s sales (see below).</li>
        </ul>
        <h3 style={h3}>Register left open / prior-day sessions</h3>
        <p style={p}>If a register was opened on a previous day and never closed, the next operator sees a <strong>&ldquo;Register Left Open&rdquo;</strong> prompt at login. Prior-day sessions are flagged in red. Two choices:</p>
        <ul style={ul}>
          <li><strong>Close Register &amp; Open New</strong> (recommended) ΓÇö closes the stale session and starts a fresh one with a new float count.</li>
          <li><strong>Continue Session</strong> ΓÇö keeps recording against the original session. Only use this if intentional.</li>
        </ul>
      </div>
    );
    if (active === 'offline') return (
      <div style={{ padding: 32, maxWidth: 760 }}>
        <h2 style={h2}>Offline Mode &amp; Sale Queue</h2>
        <p style={p}>The POS keeps working when the internet drops. A local product cache lets operators keep ringing up sales; completed sales are written to an on-device queue and upload automatically when the connection returns.</p>
        <h3 style={h3}>Status badges in the header</h3>
        <ul style={ul}>
          <li><strong style={{ color: '#4ade80' }}>Online / Offline</strong> ΓÇö current connectivity.</li>
          <li><strong style={{ color: '#fbbf24' }}>Queued (amber)</strong> ΓÇö sales waiting to upload. Drain automatically when back online, or hit <strong>Γƒ│ Sync</strong> manually.</li>
          <li><strong style={{ color: '#f87171' }}>Failed (red)</strong> ΓÇö a sale that repeatedly failed to upload. Saved on-device ΓÇö <em>never discarded</em>. Tap the badge to retry.</li>
        </ul>
        <h3 style={h3}>Duplicate protection</h3>
        <p style={p}>Each sale carries a unique local ID. Even if a queued sale is sent twice it can only ever be recorded once ΓÇö no duplicate sales from retries.</p>
        <h3 style={h3}>Before logging out</h3>
        <p style={p}>Logging out while sales are pending shows a warning. <strong>Don&apos;t clear browser data or switch devices until the queue is empty</strong> ΓÇö offline sales live on this device until they sync.</p>
        <h3 style={h3}>Stale product cache</h3>
        <p style={p}>Product prices and stock are cached at login and refreshed automatically every 15 minutes and when the tab regains focus. If the cache is older than 4 hours and you&apos;re offline, a warning banner appears ΓÇö hit <strong>Γƒ│ Sync</strong> once back online.</p>
      </div>
    );
    if (active === 'pin') return (
      <div style={{ padding: 32, maxWidth: 760 }}>
        <h2 style={h2}>PIN Security</h2>
        <p style={p}>POS operators sign in with a short numeric PIN. PINs are stored hashed ΓÇö never in plain text.</p>
        <h3 style={h3}>Lockout policy</h3>
        <p style={p}>Repeated failed PIN attempts trigger a temporary lockout on that operator before they can try again. This deters guessing without locking out the terminal entirely.</p>
        <h3 style={h3}>Supervisor PIN</h3>
        <p style={p}>A separate <strong>supervisor PIN</strong> is set during device setup. It authorises overrides (discounts, voids) that require manager approval.</p>
        <h3 style={h3}>Device binding</h3>
        <p style={p}>Each device is bound to a single location and register at setup. If that register is later removed or deactivated in IMS, the device prompts for re-setup at next login rather than attaching sales to a register that no longer exists.</p>
        <h3 style={h3}>Admin fallback</h3>
        <p style={p}>If a staff member has no PIN set, any IMS admin can log in using their full email and password via the &ldquo;Admin login&rdquo; link on the staff picker screen.</p>
        <h3 style={h3}>Managing POS users</h3>
        <p style={p}>POS users are separate from IMS web users. Manage them in <strong>IMS ΓåÆ Settings ΓåÆ Point of Sale ΓåÆ Users</strong>.</p>
      </div>
    );
    return null;
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 2000, display: 'flex' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Left nav */}
      <div style={{ width: 210, background: 'var(--sv-bg-0)', borderRight: '1px solid var(--sv-etch)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 14px' }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--sv-text-strong)' }}>POS Help</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sv-text-dim)', fontSize: 22, lineHeight: 1, padding: 0 }}>├ù</button>
        </div>
        <div style={{ height: 1, background: 'var(--sv-etch)', margin: '0 0 8px' }} />
        {NAV_ITEMS.map(item => {
          const isActive = active === item.id;
          return (
            <button key={item.id} onClick={() => setActive(item.id)} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 16px', background: isActive ? 'rgba(96,165,250,.12)' : 'transparent', border: 'none', cursor: 'pointer', color: isActive ? 'var(--sv-text-strong)' : 'var(--sv-text-dim)', fontWeight: isActive ? 600 : 400, fontSize: 13, textAlign: 'left', borderLeft: isActive ? '3px solid #60a5fa' : '3px solid transparent', transition: 'background .12s' }}>
              <span style={{ width: 16, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </div>
      {/* Right content */}
      <div style={{ flex: 1, background: 'var(--sv-bg-1)', overflow: 'auto', minWidth: 0 }}>
        <Content />
      </div>
    </div>
  );
}

// ΓöÇΓöÇΓöÇ Root Page ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

export default function PosPage() {
  const [screen, setScreen] = useState<'loading' | 'setup' | 'login' | 'register_gate' | 'pos' | 'receipt'>('loading');
  const [deviceConfig, setDeviceConfig] = useState<DeviceConfig | null>(null);
  const [session, setSession]           = useState<PosSession | null>(null);
  const [products, setProducts]         = useState<CachedProduct[]>([]);
  const [methods,  setMethods]          = useState<string[]>(['Cash', 'Card', 'EFT']);
  const [defaultView, setDefaultView]   = useState<string | null>(null);
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null);
  const [lastSale, setLastSale]           = useState<CompletedSale | null>(null);
  const [printSettings, setPrintSettings] = useState<ReceiptPrintSettings>({ business_name: '', business_address: '', business_abn: '', pos_receipt_footer: '' });
  const [offlineMode, setOfflineMode]   = useState(false);
  const [openRegSession, setOpenRegSession] = useState<any>(null);
  const [openEodOnMount, setOpenEodOnMount] = useState(false);

  function checkRegisterGate(sess: PosSession, cfg: DeviceConfig, thenGoPos: () => void) {
    if (!cfg.register_id) { thenGoPos(); return; }
    // Validate the configured register still exists and is active. If it was
    // deleted/deactivated in IMS, force device re-setup rather than attaching
    // sales to a dangling register_id.
    fetch(`/api/pos/registers?location_id=${cfg.location_id}`)
      .then(r => r.json())
      .then(rd => {
        const reg = (rd.registers ?? []).find((x: any) => x.id === cfg.register_id);
        if (!reg || !reg.is_active) {
          alert('This register is no longer available (it may have been removed or deactivated). Please set the device up again.');
          clearDeviceConfig();
          setDeviceConfig(null);
          setScreen('setup');
          return;
        }
        // Register is valid ΓÇö check for an open (possibly stale) session.
        fetch(`/api/pos/register/session?register_id=${cfg.register_id}`)
          .then(r => r.json())
          .then(rd2 => {
            if (rd2.session) { setOpenRegSession(rd2.session); setScreen('register_gate'); }
            else thenGoPos();
          })
          .catch(() => thenGoPos());
      })
      .catch(() => thenGoPos()); // offline ΓÇö don't block; proceed with cached config
  }

  // Background stock sync every 5 minutes while POS is active
  // NOTE: must be here (before early returns) to satisfy Rules of Hooks
  useEffect(() => {
    if (screen !== 'pos' && screen !== 'receipt') return;
    const id = setInterval(() => { handleSync().catch(() => {}); }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [screen, deviceConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Register service worker for offline shell caching
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  useEffect(() => {
    fetch('/api/pos/settings/receipt').then(r => r.json()).then(d => setPrintSettings(d)).catch(() => {});
    fetch('/api/pos/settings/products').then(r => r.json()).then(d => { setDefaultView(d.defaultView || 'all'); }).catch(() => { setDefaultView('all'); });
  }, []);

  useEffect(() => {
    const cfg = loadDeviceConfig();
    if (cfg) {
      setDeviceConfig(cfg);
      // Check if still logged in ΓÇö pass location_id so admin sessions can auto-create a POS session
      fetch(`/api/pos/auth/me?location_id=${cfg.location_id}`).then(r => r.json()).then(d => {
        if (d.session) {
          const sess: PosSession = {
            ...d.session,
            register_id:   cfg.register_id   ?? null,
            register_name: cfg.register_name ?? null,
          };
          saveLocalSession(sess);
          setOfflineMode(false);
          setSession(sess);
          const cached = loadProductsCache();
          if (cached.length) setProducts(cached);
          checkRegisterGate(sess, cfg, () => setScreen('pos'));
          // Always refresh products + payment methods in background
          Promise.all([
            fetch(`/api/pos/products?location_id=${cfg.location_id}`),
            fetch('/api/pos/settings/payment-methods'),
            fetch('/api/pos/settings/products'),
          ]).then(async ([prodRes, methodRes, viewRes]) => {
            const prodData   = await prodRes.json().catch(() => ({ products: [] }));
            const methodData = await methodRes.json().catch(() => ({ methods: [] }));
            const viewData   = await viewRes.json().catch(() => ({ defaultView: 'all' }));
            const freshProducts = prodData.products ?? [];
            if (freshProducts.length) {
              saveProductsCache(freshProducts);
              setProducts(freshProducts);
            }
            if (Array.isArray(methodData.methods) && methodData.methods.length) {
              setMethods(methodData.methods);
            }
            if (viewData.defaultView) setDefaultView(viewData.defaultView);
            else setDefaultView(prev => prev ?? 'all');
          }).catch(() => {/* offline ΓÇö keep cached */});
        } else {
          clearLocalSession();
          setScreen('login');
        }
      }).catch(() => {
        // Network error ΓÇö try offline recovery from local cache
        const cachedSession = loadLocalSession() as PosSession | null;
        const cachedProducts = loadProductsCache();
        if (cachedSession && cachedProducts.length) {
          setSession(cachedSession);
          setProducts(cachedProducts);
          setOfflineMode(true);
          setScreen('pos');
        } else {
          setScreen('login');
        }
      });
    } else {
      setScreen('setup');
    }
  }, []);

  if (screen === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--sv-bg-0)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sv-text-dim)', fontFamily: 'system-ui,sans-serif' }}>
        Loading POSΓÇª
      </div>
    );
  }

  if (screen === 'setup' || !deviceConfig) {
    return <DeviceSetup onSetup={(cfg) => { setDeviceConfig(cfg); setScreen('login'); }} />;
  }

  if (screen === 'login' || !session) {
    return (
      <LoginScreen
        deviceConfig={deviceConfig}
        onLogin={(sess, prods, mets) => {
          setSession(sess);
          setProducts(prods);
          setMethods(mets);
          checkRegisterGate(sess, deviceConfig, () => setScreen('pos'));
        }}
        onDeviceSetup={() => { clearDeviceConfig(); setDeviceConfig(null); setScreen('setup'); }}
      />
    );
  }

  if (screen === 'register_gate' && session && deviceConfig) {
    return (
      <RegisterGate
        session={session}
        deviceConfig={deviceConfig}
        staleSession={openRegSession}
        onContinue={() => { setOpenRegSession(null); setScreen('pos'); }}
        onGoToEod={() => { setOpenRegSession(null); setOpenEodOnMount(true); setScreen('pos'); }}
      />
    );
  }

  if (screen === 'receipt' && completedSale) {
    return (
      <ReceiptScreen
        sale={completedSale}
        printSettings={printSettings}
        onClose={() => { setCompletedSale(null); setScreen('pos'); }}
      />
    );
  }

  async function handleSync() {
    if (!deviceConfig) return;
    const [prodRes, methodRes] = await Promise.all([
      fetch(`/api/pos/products?location_id=${deviceConfig.location_id}`),
      fetch('/api/pos/settings/payment-methods'),
    ]);
    const prodData   = await prodRes.json().catch(() => ({ products: [] }));
    const methodData = await methodRes.json().catch(() => ({ methods: [] }));
    const freshProducts = prodData.products ?? [];
    if (freshProducts.length) { saveProductsCache(freshProducts); setProducts(freshProducts); }
    if (Array.isArray(methodData.methods) && methodData.methods.length) setMethods(methodData.methods);
    setOfflineMode(false);
  }

  return (
    <MainPos
      deviceConfig={deviceConfig}
      session={session}
      products={products}
      paymentMethods={methods}
      defaultView={defaultView}
      offlineMode={offlineMode}
      openEodOnMount={openEodOnMount}
      onEodMounted={() => setOpenEodOnMount(false)}
      onSync={handleSync}
      lastSale={lastSale}
      onSaleCompleted={(sale) => setLastSale(sale)}
      onLogout={async () => {
        // Try to flush any queued sales before logging out ΓÇö never silently abandon them.
        try { await drainOfflineQueue(); } catch {}
        const pending = loadOfflineQueue().length + loadFailedQueue().length;
        if (pending > 0) {
          const proceed = confirm(
            `${pending} sale${pending !== 1 ? 's have' : ' has'} not yet synced to the server. ` +
            `They are saved on this device and will sync once it reconnects ΓÇö they will NOT be lost. ` +
            `Log out anyway?`,
          );
          if (!proceed) return;
        }
        await fetch('/api/pos/auth/logout', { method: 'POST' });
        clearLocalSession();
        setSession(null);
        setScreen('login');
      }}
      onReceipt={(sale) => {
        // Instantly patch local SOH so counts update without waiting for a full sync
        if (sale.sale_type !== 'return') {
          setProducts(prev => {
            const updated = prev.map(p => {
              const item = sale.items.find(i => i.variant_id === p.variant_id);
              if (!item) return p;
              return { ...p, soh: Math.max(0, p.soh - item.qty), soh_all: Math.max(0, p.soh_all - item.qty) };
            });
            saveProductsCache(updated);
            return updated;
          });
        } else {
          // Return ΓÇö add stock back
          setProducts(prev => {
            const updated = prev.map(p => {
              const item = sale.items.find(i => i.variant_id === p.variant_id);
              if (!item) return p;
              return { ...p, soh: p.soh + item.qty, soh_all: p.soh_all + item.qty };
            });
            saveProductsCache(updated);
            return updated;
          });
        }
        setCompletedSale(sale);
        setLastSale(sale);
        setScreen('receipt');
      }}
    />
  );
}
