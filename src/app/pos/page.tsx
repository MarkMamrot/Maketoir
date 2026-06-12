'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { DeviceConfig, PosSession, CachedProduct, CartItem, PaymentEntry, ParkedSale, CompletedSale } from './_types';
import {
  loadDeviceConfig, saveDeviceConfig, clearDeviceConfig,
  loadProductsCache, saveProductsCache,
  loadCurrentCart, saveCurrentCart,
  loadParkedSales, saveParkedSales,
  addToOfflineQueue, drainOfflineQueue,
  newLocalId,
} from './_store';

// ─── Utilities ────────────────────────────────────────────────────────────────

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

// ─── DeviceSetup Screen ───────────────────────────────────────────────────────

function DeviceSetup({ onSetup }: { onSetup: (cfg: DeviceConfig) => void }) {
  const [locations, setLocations]     = useState<{ id: number; name: string }[]>([]);
  const [locationId, setLocationId]   = useState('');
  const [manualName, setManualName]   = useState('');
  const [pin, setPin]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    fetch('/api/pos/locations').then(r => r.json()).then(d => setLocations(d.locations ?? [])).catch(() => {});
  }, []);

  async function handleSetup() {
    if (!locationId && !manualName) { setError('Select or enter a location.'); return; }
    setLoading(true);
    setError('');
    try {
      const loc = locations.find(l => l.id === Number(locationId));
      const finalId   = locationId ? Number(locationId) : 0;
      const finalName = loc?.name ?? manualName.trim() ?? `Location ${finalId}`;
      if (!finalName) { setError('Enter a location name.'); return; }
      const cfg: DeviceConfig = {
        location_id:   finalId,
        location_name: finalName,
        supervisor_pin: pin ? await hashPin(pin) : undefined,
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
        <h1 style={{ margin: '0 0 .5rem', fontSize: '1.4rem', color: 'var(--sv-text-strong)' }}>POS — Device Setup</h1>
        <p style={{ color: 'var(--sv-text-dim)', marginBottom: '1.5rem', fontSize: '.9rem' }}>Configure this device once. Use a Supervisor PIN to allow cashiers to change branches without full re-setup.</p>

        <label style={labelStyle}>Branch / Location</label>
        {locations.length > 0 ? (
          <select value={locationId} onChange={e => setLocationId(e.target.value)} style={inputStyle}>
            <option value=''>— select location —</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        ) : (
          <div>
            <input type='number' placeholder='Location ID (number)' value={locationId} onChange={e => setLocationId(e.target.value)} style={{ ...inputStyle, marginBottom: '.4rem' }} />
            <input placeholder='Location Name' value={manualName} onChange={e => setManualName(e.target.value)} style={inputStyle} />
            <p style={{ color: 'var(--sv-text-dim)', fontSize: '.75rem', margin: '-.5rem 0 .75rem' }}>Log into the admin portal first to auto-populate locations.</p>
          </div>
        )}

        <label style={labelStyle}>Supervisor PIN (optional)</label>
        <input type='password' maxLength={8} placeholder='4-8 digit PIN' value={pin} onChange={e => setPin(e.target.value)} style={inputStyle} />

        {error && <p style={{ color: 'var(--sv-red)', fontSize: '.85rem', marginBottom: '1rem' }}>{error}</p>}

        <button onClick={handleSetup} disabled={loading} style={primaryBtn}>
          {loading ? 'Saving…' : 'Set Up Device'}
        </button>
      </div>
    </div>
  );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────

function LoginScreen({ deviceConfig, onLogin, onDeviceSetup }: {
  deviceConfig:  DeviceConfig;
  onLogin:       (session: PosSession, products: CachedProduct[], methods: string[]) => void;
  onDeviceSetup: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const passRef = useRef<HTMLInputElement>(null);

  async function handleLogin() {
    if (!username || !password) { setError('Enter username and password.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/pos/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, location_id: deviceConfig.location_id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Login failed.'); return; }

      // Fetch products for offline cache
      const [prodRes, methodRes] = await Promise.all([
        fetch(`/api/pos/products?location_id=${deviceConfig.location_id}`),
        fetch('/api/pos/settings/payment-methods'),
      ]);
      const prodData   = await prodRes.json().catch(() => ({ products: [] }));
      const methodData = await methodRes.json().catch(() => ({ methods: ['Cash', 'Card', 'EFT'] }));

      saveProductsCache(prodData.products ?? []);
      onLogin(data.session, prodData.products ?? [], methodData.methods ?? ['Cash', 'Card', 'EFT']);
    } catch (e: any) {
      setError(e.message || 'Network error.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sv-bg-0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', padding: '2.5rem 2rem', borderRadius: 12, width: 360, boxShadow: '0 8px 40px rgba(0,0,0,.4)' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '.25rem' }}>🛒</div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--sv-text-strong)' }}>POS Login</h1>
          <p style={{ margin: '.25rem 0 0', color: 'var(--sv-action)', fontSize: '.95rem', fontWeight: 600 }}>{deviceConfig.location_name}</p>
        </div>

        <label style={labelStyle}>Username</label>
        <input autoFocus value={username} onChange={e => setUsername(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && passRef.current?.focus()}
          style={inputStyle} placeholder='cashier username' />

        <label style={labelStyle}>Password</label>
        <input ref={passRef} type='password' value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          style={inputStyle} placeholder='password' />

        {error && <p style={{ color: 'var(--sv-red)', fontSize: '.85rem', margin: '-.5rem 0 .75rem' }}>{error}</p>}

        <button onClick={handleLogin} disabled={loading} style={{ ...primaryBtn, width: '100%' }}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>

        <button onClick={onDeviceSetup} style={{ width: '100%', marginTop: '.75rem', padding: '.6rem', background: 'transparent', border: '1px solid var(--sv-etch)', borderRadius: 8, color: 'var(--sv-text-dim)', cursor: 'pointer', fontSize: '.85rem' }}>
          Change Branch / Device Setup
        </button>
      </div>
    </div>
  );
}

// ─── Main POS Layout ──────────────────────────────────────────────────────────

type MainScreen = 'pos' | 'eod' | 'reports' | 'parked';

function MainPos({
  deviceConfig, session, products, paymentMethods,
  onLogout, onReceipt,
}: {
  deviceConfig:   DeviceConfig;
  session:        PosSession;
  products:       CachedProduct[];
  paymentMethods: string[];
  onLogout:       () => void;
  onReceipt:      (sale: CompletedSale) => void;
}) {
  const [screen, setScreen] = useState<MainScreen>('pos');
  const [cart, setCart] = useState<CartItem[]>(() => loadCurrentCart());
  const [parkedSales, setParkedSales] = useState<ParkedSale[]>(() => loadParkedSales());
  const [showPayment, setShowPayment] = useState(false);
  const [isReturn, setIsReturn] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [isLayby, setIsLayby] = useState(false);

  // Persist cart on change
  useEffect(() => { saveCurrentCart(cart); }, [cart]);

  // Drain offline queue on mount and when online
  useEffect(() => {
    drainOfflineQueue();
    const handler = () => drainOfflineQueue();
    window.addEventListener('online', handler);
    return () => window.removeEventListener('online', handler);
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

    clearCart();
    setShowPayment(false);
    onReceipt(completedSale);
  }

  if (screen === 'eod') return <EodScreen session={session} onBack={() => setScreen('pos')} />;
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
      <div style={{ display: 'flex', alignItems: 'center', padding: '.4rem 1rem', borderBottom: '1px solid var(--sv-etch)', gap: '.5rem', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, color: 'var(--sv-action)', fontSize: '1rem', letterSpacing: -.2 }}>🛒 POS</span>
        <span style={{ color: 'var(--sv-text-strong)', fontSize: '.9rem', fontWeight: 600 }}>{session.location_name}</span>
        <span style={{ color: 'var(--sv-text-dim)', fontSize: '.82rem' }}>· {session.full_name}</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setIsReturn(!isReturn)} style={{ ...smallBtn, background: isReturn ? 'var(--sv-red-tint)' : 'rgba(255,255,255,.1)', color: isReturn ? 'var(--sv-red)' : 'var(--sv-text-strong)', border: `1px solid ${isReturn ? 'var(--sv-red-border)' : 'rgba(255,255,255,.18)'}` }}>
          {isReturn ? '↩ Return Mode ON' : 'Return / Refund'}
        </button>
        <button onClick={() => setIsLayby(!isLayby)} style={{ ...smallBtn, background: isLayby ? 'var(--sv-amber-tint)' : 'rgba(255,255,255,.1)', color: isLayby ? 'var(--sv-amber)' : 'var(--sv-text-strong)', border: `1px solid ${isLayby ? 'var(--sv-amber-border)' : 'rgba(255,255,255,.18)'}` }}>
          {isLayby ? '📋 Layby ON' : 'Layby'}
        </button>
        <button onClick={parkSale} style={{ ...smallBtn, background: 'rgba(255,255,255,.1)', color: 'var(--sv-text-strong)', border: '1px solid rgba(255,255,255,.18)' }} disabled={!cart.length}>Park Sale</button>
        <button onClick={() => setScreen('parked')} style={{ ...smallBtn, background: 'rgba(255,255,255,.1)', color: 'var(--sv-text-strong)', border: '1px solid rgba(255,255,255,.18)' }}>
          Parked {parkedSales.length > 0 ? `(${parkedSales.length})` : ''}
        </button>
        <button onClick={() => setScreen('eod')} style={{ ...smallBtn, background: 'rgba(255,255,255,.1)', color: 'var(--sv-text-strong)', border: '1px solid rgba(255,255,255,.18)' }}>EOD</button>
        <button onClick={() => setScreen('reports')} style={{ ...smallBtn, background: 'rgba(255,255,255,.1)', color: 'var(--sv-text-strong)', border: '1px solid rgba(255,255,255,.18)' }}>Reports</button>
        <button onClick={onLogout} style={{ ...smallBtn, background: 'rgba(255,255,255,.1)', color: 'var(--sv-red)', border: '1px solid var(--sv-red-border)' }}>Log Out</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Product Panel */}
        <ProductPanel products={products} onAdd={addToCart} isReturn={isReturn} onChargeEnter={() => { if (cart.length && !showPayment) setShowPayment(true); }} />

        {/* Cart Panel */}
        <div style={{ width: 380, display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--sv-etch)', background: 'var(--sv-bg-1)' }}>
          {/* Customer info */}
          <div style={{ padding: '.5rem .75rem', display: 'flex', gap: '.5rem' }}>
            <input placeholder='Customer name' value={customerName} onChange={e => setCustomerName(e.target.value)} style={{ ...inputStyle, flex: 1, marginBottom: 0, padding: '.35rem .5rem', fontSize: '.8rem' }} />
            <input placeholder='Phone' value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} style={{ ...inputStyle, width: 110, marginBottom: 0, padding: '.35rem .5rem', fontSize: '.8rem' }} />
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

            <div style={{ display: 'flex', gap: '.5rem', marginTop: '.75rem' }}>
              <button onClick={clearCart} style={{ ...smallBtn, flex: 1 }} disabled={!cart.length}>Clear</button>
              <button
                onClick={() => setShowPayment(true)}
                disabled={!cart.length}
                style={{ flex: 2, padding: '.7rem', background: 'var(--sv-action)', border: '1px solid var(--sv-action)', borderRadius: 8, color: '#fff', cursor: cart.length ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: '1rem', opacity: cart.length ? 1 : 0.4, transition: 'opacity .2s' }}
              >
                {isLayby ? `Layby $${fmt(totals.total)}` : `Charge $${fmt(totals.total)}`}
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
    </div>
  );
}

// ─── Recent product helpers ───────────────────────────────────────────────────

function loadRecentIds(): string[] {
  try { return JSON.parse(localStorage.getItem('pos_recent_vids') ?? '[]'); } catch { return []; }
}
function saveRecentIds(ids: string[]): void {
  try { localStorage.setItem('pos_recent_vids', JSON.stringify(ids)); } catch {}
}

// ─── Product Panel ────────────────────────────────────────────────────────────

function ProductPanel({ products, onAdd, isReturn, onChargeEnter }: { products: CachedProduct[]; onAdd: (p: CachedProduct) => void; isReturn: boolean; onChargeEnter?: () => void }) {
  const [search, setSearch]             = useState('');
  const [brand, setBrand]               = useState('');
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
  const filtered = useMemo(() => {
    let list = brand ? sortedProducts.filter(p => p.brand === brand) : sortedProducts;
    if (mode === 'search' && search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p => matchQuery(p, q));
    }
    return list;
  }, [sortedProducts, brand, mode, search]);

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
          // Empty search + Enter → open payment / charge
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
            placeholder='Search by name, brand or scan barcode…'
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
                    <div style={{ fontSize: '.72rem', color: 'var(--sv-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[p.brand, p.code].filter(Boolean).join(' · ')}</div>
                  </div>
                  <span style={{ fontWeight: 700, color: 'var(--sv-action)', fontSize: '.85rem', flexShrink: 0 }}>${fmt(p.price)}</span>
                  <span style={{ fontSize: '.72rem', padding: '2px 6px', borderRadius: 5, background: p.soh > 0 ? 'var(--sv-mint-tint)' : 'var(--sv-red-tint)', color: p.soh > 0 ? 'var(--sv-mint)' : 'var(--sv-red)', flexShrink: 0 }}>{p.soh > 0 ? p.soh : 'OOS'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Search button: commits to full grid results mode */}
        <button
          onClick={() => { if (search.trim()) { setMode('search'); setDropdownOpen(false); setHighlightIdx(-1); inputRef.current?.focus(); } }}
          disabled={!search.trim()}
          title="Show all matching products"
          style={{ flexShrink: 0, padding: '6px 11px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: search.trim() ? 'var(--sv-bg-2)' : 'transparent', color: search.trim() ? 'var(--sv-action)' : 'var(--sv-text-muted)', cursor: search.trim() ? 'pointer' : 'default', fontSize: 15, lineHeight: 1 }}
        >🔍</button>
      </div>

      {/* Search results banner */}
      {mode === 'search' && (
        <div style={{ padding: '4px 12px 6px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--sv-action)' }}>🔍 Results for <strong>"{search}"</strong> — {filtered.length} product{filtered.length !== 1 ? 's' : ''}</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => { setMode('browse'); setSearch(''); setDropdownOpen(false); inputRef.current?.focus(); }}
            style={{ fontSize: 12, padding: '2px 10px', borderRadius: 5, border: '1px solid var(--sv-etch)', background: 'none', color: 'var(--sv-text-dim)', cursor: 'pointer' }}
          >× Clear</button>
        </div>
      )}

      {/* Product grid */}
      <div style={{ flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: '.5rem', padding: '.75rem', alignContent: 'start' }}>
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
                padding: '.6rem .75rem',
                textAlign: 'left',
                cursor: 'pointer',
                color: 'var(--sv-text-main)',
                position: 'relative',
                transition: 'border-color .15s, background .15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--sv-action)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = isRecent ? 'rgba(37,99,235,.35)' : 'var(--sv-etch)')}
            >
              <div style={{ fontSize: '.72rem', color: 'var(--sv-text-dim)', marginBottom: '.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.brand ?? p.code ?? '—'}</div>
              <div style={{ fontSize: '.85rem', fontWeight: 600, lineHeight: 1.3, color: 'var(--sv-text-strong)', maxHeight: '2.6em', overflow: 'hidden', marginBottom: '.35rem' }}>{p.name}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: 'var(--sv-action)', fontSize: '.9rem' }}>${fmt(p.price)}</span>
                <span style={{ fontSize: '.72rem', padding: '.1rem .45rem', borderRadius: 5, background: p.soh > 0 ? 'var(--sv-mint-tint)' : 'var(--sv-red-tint)', color: p.soh > 0 ? 'var(--sv-mint)' : 'var(--sv-red)', fontWeight: 600 }}>
                  {p.soh > 0 ? p.soh : 'OOS'}
                </span>
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
    </div>
  );
}

// ─── Cart Row ─────────────────────────────────────────────────────────────────

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
        <button onClick={onRemove} style={{ background: 'transparent', border: 'none', color: 'var(--sv-red)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 .25rem' }}>×</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginTop: '.3rem' }}>
        {/* Qty controls */}
        <button onClick={() => onQty(-1)} style={qtyBtn}>−</button>
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
          <button onClick={() => setEditPrice(true)} style={{ background: 'transparent', border: 'none', color: 'var(--sv-action)', cursor: 'pointer', fontSize: '.85rem', fontWeight: 600 }}>
            ${fmt(item.unit_price)}
          </button>
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
          <button onClick={() => setEditDisc(true)} style={{ background: 'transparent', border: 'none', color: item.discount_amount > 0 ? 'var(--sv-amber)' : 'var(--sv-text-muted)', cursor: 'pointer', fontSize: '.78rem' }}>
            {item.discount_amount > 0 ? `-$${fmt(item.discount_amount)}` : 'disc.'}
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: '.9rem' }}>${fmt(item.line_total)}</span>
      </div>
    </div>
  );
}

// ─── Total Row ────────────────────────────────────────────────────────────────

function TotalRow({ label, value, large, muted, color }: { label: string; value: number; large?: boolean; muted?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: large ? '.4rem 0' : '.15rem 0', fontSize: large ? '1.2rem' : '.9rem', fontWeight: large ? 700 : 400, color: color ?? (muted ? 'var(--sv-text-dim)' : large ? 'var(--sv-text-strong)' : 'var(--sv-text-main)'), borderTop: large ? '1px solid var(--sv-etch)' : 'none', marginTop: large ? '.25rem' : 0 }}>
      <span>{label}</span>
      <span>${fmt(Math.abs(value))}{value < 0 ? '' : ''}</span>
    </div>
  );
}

// ─── Payment Modal ────────────────────────────────────────────────────────────

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
  const amountRef = useRef<HTMLInputElement>(null);

  const paid      = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = total - paid;
  const change    = Math.max(0, paid - total);

  useEffect(() => { amountRef.current?.focus(); }, [activeMethod]);

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
      onComplete(newPayments);
    }
  }

  function removePayment(localId: string) {
    setPayments(prev => prev.filter(p => p.localId !== localId));
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
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
                  <button onClick={() => removePayment(p.localId)} style={{ background: 'transparent', border: 'none', color: 'var(--sv-red)', cursor: 'pointer' }}>×</button>
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
            {isLayby ? `Save Layby` : `Complete Sale`} ✓
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Parked Sales Screen ──────────────────────────────────────────────────────

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
          <button onClick={onBack} style={smallBtn}>← Back to POS</button>
          <h1 style={{ margin: 0, color: 'var(--sv-text-strong)', fontSize: '1.3rem' }}>Parked Sales</h1>
        </div>
        {sales.length === 0 && <p style={{ color: 'var(--sv-text-muted)' }}>No parked sales.</p>}
        {sales.map(s => (
          <div key={s.local_id} style={{ background: 'var(--sv-bg-2)', borderRadius: 8, padding: '1rem', marginBottom: '.75rem', display: 'flex', alignItems: 'center', gap: '1rem', border: '1px solid var(--sv-etch)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: 'var(--sv-text-strong)' }}>{s.label}</div>
              {s.customer_name && <div style={{ fontSize: '.85rem', color: 'var(--sv-text-dim)' }}>{s.customer_name}</div>}
              <div style={{ fontSize: '.8rem', color: 'var(--sv-text-muted)' }}>{new Date(s.created_at).toLocaleString()} — {s.items.length} item(s)</div>
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

// ─── Receipt Screen ───────────────────────────────────────────────────────────

interface ReceiptPrintSettings {
  business_name: string;
  business_address: string;
  business_abn: string;
  pos_receipt_footer: string;
}

function ReceiptScreen({ sale, onClose, printSettings }: { sale: CompletedSale; onClose: () => void; printSettings?: ReceiptPrintSettings }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--sv-bg-0)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif' }}>
      <style>{`
        @media print {
          body > *:not(.pos-receipt-wrapper) { display: none !important; }
          .pos-receipt-wrapper { position: static !important; box-shadow: none !important; background: #fff !important; color: #000 !important; width: 80mm !important; padding: 0 !important; }
          .no-print { display: none !important; }
        }
      `}</style>

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
            {sale.id ? `#${sale.id}` : `local:${sale.local_id.slice(-8)}`} — {sale.sale_type.toUpperCase()}
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

      <div className='no-print' style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
        <button onClick={() => window.print()} style={{ ...primaryBtn, padding: '.6rem 1.5rem' }}>🖨 Print Receipt</button>
        <button onClick={onClose} style={{ ...smallBtn, padding: '.6rem 1.5rem' }}>New Sale</button>
      </div>
    </div>
  );
}

// ─── EOD Screen ───────────────────────────────────────────────────────────────

const AUD_DENOMS = [
  { label: '$100', value: 100 }, { label: '$50', value: 50 },
  { label: '$20', value: 20 },  { label: '$10', value: 10 },
  { label: '$5', value: 5 },    { label: '$2', value: 2 },
  { label: '$1', value: 1 },    { label: '50¢', value: 0.5 },
  { label: '20¢', value: 0.2 }, { label: '10¢', value: 0.1 },
  { label: '5¢', value: 0.05 },
];

function EodScreen({ session, onBack }: { session: PosSession; onBack: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [expected, setExpected] = useState<Record<string, number>>({});
  const [entries, setEntries]   = useState<Record<string, { counted: string; openingFloat: string; denominations: Record<string, string>; notes: string; showDenom: boolean }>>({});
  const [loading, setLoading]   = useState(false);
  const [saved,   setSaved]     = useState(false);
  const [methods, setMethods]   = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/pos/settings/payment-methods').then(r => r.json()).then(d => setMethods(d.methods ?? []));
  }, []);

  useEffect(() => {
    if (!methods.length) return;
    setLoading(true);
    fetch(`/api/pos/eod?location_id=${session.location_id}&date=${date}`)
      .then(r => r.json())
      .then(d => {
        setExpected(d.expected ?? {});
        const init: typeof entries = {};
        for (const m of methods) {
          const rec = (d.reconciliations ?? []).find((r: any) => r.payment_method === m);
          init[m] = {
            counted:      rec?.counted_amount != null ? String(rec.counted_amount) : '',
            openingFloat: rec?.opening_float  != null ? String(rec.opening_float)  : '',
            denominations: rec?.denomination_data ?? {},
            notes:         rec?.notes ?? '',
            showDenom:     false,
          };
        }
        setEntries(init);
      })
      .finally(() => setLoading(false));
  }, [date, methods, session.location_id]);

  function updateEntry(method: string, key: string, value: string | boolean | Record<string, string>) {
    setEntries(prev => ({ ...prev, [method]: { ...prev[method], [key]: value } }));
  }

  function calcCash(denoms: Record<string, string>): number {
    return AUD_DENOMS.reduce((sum, d) => sum + d.value * (parseFloat(denoms[String(d.value)] ?? '0') || 0), 0);
  }

  async function saveEod() {
    setLoading(true);
    const entriesArr = methods.map(m => {
      const e = entries[m] ?? {};
      const counted = m === 'Cash'
        ? calcCash(e.denominations ?? {})
        : parseFloat(e.counted ?? '0') || 0;
      return {
        payment_method:   m,
        counted_amount:   counted,
        opening_float:    parseFloat(e.openingFloat ?? '0') || null,
        denomination_data: m === 'Cash' ? Object.fromEntries(Object.entries(e.denominations ?? {}).map(([k, v]) => [k, parseFloat(v) || 0])) : null,
        notes: e.notes || null,
      };
    });
    try {
      await fetch('/api/pos/eod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: session.location_id, date, entries: entriesArr }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sv-bg-0)', padding: '1.5rem', fontFamily: 'system-ui,sans-serif', color: 'var(--sv-text-main)' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <button onClick={onBack} style={smallBtn}>← Back to POS</button>
          <h1 style={{ margin: 0, color: 'var(--sv-text-strong)', flex: 1, fontSize: '1.3rem' }}>End of Day Reconciliation</h1>
          <input type='date' value={date} onChange={e => setDate(e.target.value)} style={{ ...inputStyle, width: 160, marginBottom: 0 }} />
        </div>

        {loading && <p style={{ color: 'var(--sv-text-dim)' }}>Loading…</p>}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.9rem' }}>
            <thead>
              <tr style={{ background: 'var(--sv-bg-2)', color: 'var(--sv-text-dim)', borderBottom: '2px solid var(--sv-etch)' }}>
                <th style={thStyle}>Method</th>
                <th style={thStyle}>Expected ($)</th>
                <th style={thStyle}>Opening Float ($)</th>
                <th style={thStyle}>Counted ($)</th>
                <th style={thStyle}>Variance</th>
                <th style={thStyle}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {methods.map(m => {
                const e = entries[m] ?? { counted: '', openingFloat: '', denominations: {}, notes: '', showDenom: false };
                const exp = expected[m] ?? 0;
                const counted = m === 'Cash' ? calcCash(e.denominations ?? {}) : parseFloat(e.counted ?? '') || 0;
                const variance = counted - exp;
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
                        <input type='number' value={e.openingFloat} onChange={ev => updateEntry(m, 'openingFloat', ev.target.value)}
                          placeholder='0.00' style={{ ...inputStyle, width: 80, marginBottom: 0, padding: '.25rem .4rem', fontSize: '.85rem' }} />
                      </td>
                      <td style={tdStyle}>
                        {m === 'Cash' ? (
                          <span style={{ fontWeight: 600 }}>${fmt(counted)}</span>
                        ) : (
                          <input type='number' value={e.counted} onChange={ev => updateEntry(m, 'counted', ev.target.value)}
                            placeholder='0.00' style={{ ...inputStyle, width: 90, marginBottom: 0, padding: '.25rem .4rem', fontSize: '.85rem' }} />
                        )}
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
                        <td colSpan={6} style={{ padding: '.75rem 1rem' }}>
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
            {loading ? 'Saving…' : 'Save Reconciliation'}
          </button>
          {saved && <span style={{ color: 'var(--sv-mint)', fontWeight: 600 }}>✓ Saved</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Reports Screen ───────────────────────────────────────────────────────────

function ReportsScreen({ session, onBack }: { session: PosSession; onBack: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
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
          <button onClick={onBack} style={smallBtn}>← Back to POS</button>
          <h1 style={{ margin: 0, color: 'var(--sv-text-strong)', flex: 1, fontSize: '1.3rem' }}>Reports</h1>
          <input type='date' value={date} onChange={e => setDate(e.target.value)} style={{ ...inputStyle, width: 160, marginBottom: 0 }} />
        </div>

        {/* 30-day bar chart */}
        {graphData.length > 0 && (
          <div style={{ background: 'var(--sv-bg-2)', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem', border: '1px solid var(--sv-etch)' }}>
            <h3 style={{ margin: '0 0 1rem', color: 'var(--sv-text-strong)', fontSize: '.95rem' }}>Daily Revenue — Last 30 Days</h3>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 80, overflowX: 'auto' }}>
              {graphData.map(d => (
                <div key={d.date} title={`${d.date}: $${fmt(d.total)} (${d.count} sale${d.count !== 1 ? 's' : ''})`}
                  style={{ flex: '0 0 auto', width: 20, height: `${(d.total / maxTotal) * 80}px`, minHeight: 2, background: d.date === date ? 'var(--sv-amber)' : 'var(--sv-action)', borderRadius: '3px 3px 0 0', cursor: 'default' }} />
              ))}
            </div>
          </div>
        )}

        {loading && <p style={{ color: 'var(--sv-text-dim)' }}>Loading…</p>}

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
                  <span style={{ flex: 1, fontSize: '.9rem', color: 'var(--sv-text-main)' }}>{t.sale.customer_name ?? '—'} <span style={{ color: 'var(--sv-text-dim)', fontSize: '.8rem' }}>({t.items.length} item{t.items.length !== 1 ? 's' : ''})</span></span>
                  <span style={{ color: t.sale.sale_type === 'return' ? 'var(--sv-red)' : 'var(--sv-mint)', fontWeight: 700 }}>
                    {t.sale.sale_type === 'return' ? '-' : ''}${fmt(t.sale.total)}
                  </span>
                  <span style={{ fontSize: '.8rem', color: 'var(--sv-text-muted)' }}>{expanded === idx ? '▲' : '▼'}</span>
                </div>
                {expanded === idx && (
                  <div style={{ borderTop: '1px solid var(--sv-etch)', padding: '.75rem 1rem', fontSize: '.85rem' }}>
                    {t.items.map((item: any) => (
                      <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '.2rem 0', borderBottom: '1px solid var(--sv-etch)' }}>
                        <span style={{ color: 'var(--sv-text-main)' }}>{item.qty}× {item.name}</span>
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

// ─── Shared styles ────────────────────────────────────────────────────────────

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
  padding: '.35rem .75rem',
  cursor: 'pointer',
  fontSize: '.82rem',
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

// ─── Root Page ────────────────────────────────────────────────────────────────

export default function PosPage() {
  const [screen, setScreen] = useState<'loading' | 'setup' | 'login' | 'pos' | 'receipt'>('loading');
  const [deviceConfig, setDeviceConfig] = useState<DeviceConfig | null>(null);
  const [session, setSession]           = useState<PosSession | null>(null);
  const [products, setProducts]         = useState<CachedProduct[]>([]);
  const [methods,  setMethods]          = useState<string[]>(['Cash', 'Card', 'EFT']);
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null);
  const [printSettings, setPrintSettings] = useState<ReceiptPrintSettings>({ business_name: '', business_address: '', business_abn: '', pos_receipt_footer: '' });

  useEffect(() => {
    fetch('/api/pos/settings/receipt').then(r => r.json()).then(d => setPrintSettings(d)).catch(() => {});
  }, []);

  useEffect(() => {
    const cfg = loadDeviceConfig();
    if (cfg) {
      setDeviceConfig(cfg);
      // Check if still logged in
      fetch('/api/pos/auth/me').then(r => r.json()).then(d => {
        if (d.session) {
          setSession(d.session);
          // Show cached products immediately while fetching fresh
          const cached = loadProductsCache();
          if (cached.length) setProducts(cached);
          setScreen('pos');
          // Always refresh products + payment methods in background
          Promise.all([
            fetch(`/api/pos/products?location_id=${cfg.location_id}`),
            fetch('/api/pos/settings/payment-methods'),
          ]).then(async ([prodRes, methodRes]) => {
            const prodData   = await prodRes.json().catch(() => ({ products: [] }));
            const methodData = await methodRes.json().catch(() => ({ methods: [] }));
            const freshProducts = prodData.products ?? [];
            if (freshProducts.length) {
              saveProductsCache(freshProducts);
              setProducts(freshProducts);
            }
            if (Array.isArray(methodData.methods) && methodData.methods.length) {
              setMethods(methodData.methods);
            }
          }).catch(() => {/* offline — keep cached */});
        } else {
          setScreen('login');
        }
      }).catch(() => setScreen('login'));
    } else {
      setScreen('setup');
    }
  }, []);

  if (screen === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--sv-bg-0)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sv-text-dim)', fontFamily: 'system-ui,sans-serif' }}>
        Loading POS…
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
          setScreen('pos');
        }}
        onDeviceSetup={() => { clearDeviceConfig(); setDeviceConfig(null); setScreen('setup'); }}
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

  return (
    <MainPos
      deviceConfig={deviceConfig}
      session={session}
      products={products}
      paymentMethods={methods}
      onLogout={async () => {
        await fetch('/api/pos/auth/logout', { method: 'POST' });
        setSession(null);
        setScreen('login');
      }}
      onReceipt={(sale) => {
        setCompletedSale(sale);
        setScreen('receipt');
      }}
    />
  );
}
