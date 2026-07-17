'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { WholesaleSession } from '@/lib/wholesale/wholesaleSession';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface WholesaleVariant {
  variant_id: string;
  product_id: string;
  sku: string | null;
  option1_value: string | null;
  option2_value: string | null;
  option3_value: string | null;
  price_wholesale: number;
  pack_size: number | null;
  available: number;
}

interface WholesaleProduct {
  id: number;
  product_id: string;
  name: string;
  description: string | null;
  product_type: string | null;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  allow_indent_wholesale: number;
  created_at: string;
  image_url: string | null;
  variants: WholesaleVariant[];
}

interface CategoryFacet { category: string; subcategory: string | null }

interface CartItem {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_label: string;
  sku: string | null;
  qty: number;
  unit_price: number;
  available: number;
  allow_indent: boolean;
  is_indent: boolean;
}

interface DraftOrder {
  id: number;
  status: 'draft' | 'submitted' | 'cancelled';
  notes: string | null;
  subtotal: number;
  total_amount: number;
  created_at: string;
  updated_at: string;
  item_count: number;
}

type PortalView = 'shop' | 'orders';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmtCurrency = (n: number) =>
  `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function variantLabel(v: WholesaleVariant): string {
  return [v.option1_value, v.option2_value, v.option3_value].filter(Boolean).join(' / ') || 'Default';
}

const CART_KEY = 'wholesale_cart';
function loadCart(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(sessionStorage.getItem(CART_KEY) ?? '[]'); } catch { return []; }
}
function saveCart(items: CartItem[]) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(CART_KEY, JSON.stringify(items));
}

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip
// ─────────────────────────────────────────────────────────────────────────────
function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span style={{
          position: 'absolute', bottom: '120%', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(15,23,42,.95)', color: '#f1f5f9', fontSize: 11, padding: '5px 9px',
          borderRadius: 6, whiteSpace: 'nowrap', zIndex: 9999, pointerEvents: 'none',
          boxShadow: '0 2px 8px rgba(0,0,0,.3)', maxWidth: 280, textAlign: 'center',
        }}>
          {text}
        </span>
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Product Card
// ─────────────────────────────────────────────────────────────────────────────
function ProductCard({
  product, onAdd, cartQtyMap,
}: {
  product: WholesaleProduct;
  onAdd: (item: Omit<CartItem, 'is_indent'>) => void;
  cartQtyMap: Record<string, number>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      boxShadow: '0 1px 3px rgba(0,0,0,.06)', transition: 'box-shadow .15s',
    }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,.1)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,.06)')}
    >
      {/* Image */}
      <div style={{ height: 180, background: '#f8fafc', overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
        {product.image_url ? (
          <img src={product.image_url} alt={product.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
        {product.allow_indent_wholesale === 1 && (
          <div style={{ position: 'absolute', top: 8, left: 8 }}>
            <Tooltip text="Indent orders available — you can order this product even when stock is unavailable.">
              <span style={{ background: '#f59e0b', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, letterSpacing: .4 }}>INDENT OK</span>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '14px 14px 6px', flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {product.brand && <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: .6 }}>{product.brand}</span>}
        <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', lineHeight: 1.3 }}>{product.name}</span>
        {product.category && <span style={{ fontSize: 11, color: '#94a3b8' }}>{[product.category, product.subcategory].filter(Boolean).join(' › ')}</span>}
      </div>

      {/* Variants */}
      <div style={{ padding: '6px 14px 14px' }}>
        {(expanded ? product.variants : product.variants.slice(0, 3)).map(v => {
          const lbl = variantLabel(v);
          const inCart  = cartQtyMap[v.variant_id] ?? 0;
          const isOos   = v.available <= 0 && !product.allow_indent_wholesale;
          const isIndent = v.available <= 0 && !!product.allow_indent_wholesale;
          return (
            <div key={v.variant_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lbl}</div>
                {v.sku && <div style={{ fontSize: 10, color: '#94a3b8' }}>{v.sku}</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{fmtCurrency(v.price_wholesale)}</span>
                  {v.pack_size && v.pack_size > 1 && <span style={{ fontSize: 10, color: '#94a3b8' }}>pk{v.pack_size}</span>}
                </div>
                <div style={{ fontSize: 10, fontWeight: 600, marginTop: 1, color: isOos ? '#ef4444' : isIndent ? '#f59e0b' : '#22c55e' }}>
                  {isOos ? 'Out of Stock' : isIndent ? `Indent (${v.available} on hand)` : `${v.available} available`}
                </div>
              </div>
              {isOos ? (
                <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 600, padding: '3px 7px', border: '1px solid #fecaca', borderRadius: 6 }}>Out of Stock</span>
              ) : (
                <button
                  onClick={() => onAdd({ variant_id: v.variant_id, product_id: product.product_id, product_name: product.name, variant_label: lbl, sku: v.sku, qty: 1, unit_price: v.price_wholesale, available: v.available, allow_indent: !!product.allow_indent_wholesale })}
                  style={{ padding: '5px 10px', fontSize: 12, fontWeight: 600, borderRadius: 7, background: inCart > 0 ? '#dbeafe' : '#2563eb', color: inCart > 0 ? '#1d4ed8' : '#fff', border: 'none', cursor: 'pointer', flexShrink: 0 }}
                >
                  {inCart > 0 ? `In Cart (${inCart})` : '+ Add'}
                </button>
              )}
            </div>
          );
        })}
        {product.variants.length > 3 && (
          <button onClick={() => setExpanded(e => !e)} style={{ marginTop: 6, fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}>
            {expanded ? '↑ Show less' : `+ ${product.variants.length - 3} more variant${product.variants.length - 3 > 1 ? 's' : ''}`}
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cart Panel
// ─────────────────────────────────────────────────────────────────────────────
function CartPanel({ items, notes, onNotesChange, onQtyChange, onRemove, onSaveDraft, onSubmit, saving, onClose }: {
  items: CartItem[]; notes: string; onNotesChange: (v: string) => void;
  onQtyChange: (vid: string, qty: number) => void; onRemove: (vid: string) => void;
  onSaveDraft: () => void; onSubmit: () => void; saving: boolean; onClose: () => void;
}) {
  const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex' }}>
      <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,.4)' }} />
      <div style={{ width: 420, maxWidth: '100vw', background: '#fff', display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>🛒 Cart ({items.length} item{items.length !== 1 ? 's' : ''})</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#94a3b8', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: 10 }}>
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0" />
              </svg>
              <p style={{ fontSize: 13 }}>Your cart is empty.</p>
            </div>
          ) : items.map(item => (
            <div key={item.variant_id} style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: 1.3 }}>{item.product_name}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>{item.variant_label}{item.sku ? ` · ${item.sku}` : ''}</div>
                {item.is_indent && <span style={{ display: 'inline-block', marginTop: 2, fontSize: 10, fontWeight: 700, color: '#f59e0b', background: '#fef3c7', padding: '1px 6px', borderRadius: 99 }}>INDENT ORDER</span>}
                <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>{fmtCurrency(item.unit_price)} × {item.qty} = <strong style={{ color: '#0f172a' }}>{fmtCurrency(item.qty * item.unit_price)}</strong></div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <button onClick={() => onRemove(item.variant_id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button onClick={() => onQtyChange(item.variant_id, Math.max(1, item.qty - 1))} style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155' }}>−</button>
                  <input type="number" min={1} max={item.allow_indent ? undefined : (item.available || undefined)} value={item.qty}
                    onChange={e => { const n = Math.max(1, parseInt(e.target.value) || 1); onQtyChange(item.variant_id, item.allow_indent ? n : Math.min(n, item.available)); }}
                    style={{ width: 42, textAlign: 'center', padding: '3px 4px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }} />
                  <button onClick={() => { const n = item.qty + 1; onQtyChange(item.variant_id, item.allow_indent ? n : Math.min(n, item.available)); }} style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155' }}>+</button>
                </div>
                {!item.allow_indent && item.available > 0 && <span style={{ fontSize: 10, color: '#94a3b8' }}>Max {item.available}</span>}
              </div>
            </div>
          ))}
          <div style={{ marginTop: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 5 }}>Order Notes</label>
            <textarea value={notes} onChange={e => onNotesChange(e.target.value)} rows={3} placeholder="Special instructions…" style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' as const }} />
          </div>
        </div>
        <div style={{ padding: '16px 20px', borderTop: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#475569' }}>Subtotal</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{fmtCurrency(subtotal)}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onSaveDraft} disabled={items.length === 0 || saving} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #2563eb', background: '#fff', color: '#2563eb', fontWeight: 600, fontSize: 13, cursor: items.length === 0 || saving ? 'not-allowed' : 'pointer', opacity: items.length === 0 ? 0.5 : 1 }}>
              {saving ? 'Saving…' : '💾 Save Draft'}
            </button>
            <button onClick={onSubmit} disabled={items.length === 0 || saving} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: items.length === 0 || saving ? '#94a3b8' : '#2563eb', color: '#fff', fontWeight: 700, fontSize: 13, cursor: items.length === 0 || saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Submitting…' : '✉️ Submit Order'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft Orders View
// ─────────────────────────────────────────────────────────────────────────────
function DraftOrdersView({ onLoadDraft }: { onLoadDraft: (id: number) => void }) {
  const [orders, setOrders] = useState<DraftOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch('/api/wholesale/orders'); const d = await r.json(); if (d.success) setOrders(d.orders ?? []); } catch { /* */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this draft order?')) return;
    setDeleting(id);
    try { await fetch(`/api/wholesale/orders/${id}`, { method: 'DELETE' }); await load(); } catch { /* */ }
    setDeleting(null);
  };

  const statusBadge = (s: string) => {
    const map: Record<string, { bg: string; color: string }> = { draft: { bg: '#dbeafe', color: '#1d4ed8' }, submitted: { bg: '#d1fae5', color: '#065f46' }, cancelled: { bg: '#fee2e2', color: '#991b1b' } };
    const st = map[s] ?? { bg: '#f1f5f9', color: '#475569' };
    return <span style={{ ...st, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, textTransform: 'uppercase' as const }}>{s}</span>;
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading orders…</div>;
  if (orders.length === 0) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
      <p style={{ fontSize: 14, marginBottom: 4 }}>No orders yet.</p>
      <p style={{ fontSize: 12 }}>Start shopping to place your first order.</p>
    </div>
  );

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>My Orders</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {orders.map(o => (
          <div key={o.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Order #{o.id}</span>
                {statusBadge(o.status)}
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{o.item_count} item{o.item_count !== 1 ? 's' : ''} · {fmtCurrency(Number(o.total_amount))}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                {new Date(o.updated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 7 }}>
              {o.status === 'draft' && <>
                <button onClick={() => onLoadDraft(o.id)} style={{ padding: '7px 14px', borderRadius: 7, background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Edit</button>
                <button onClick={() => handleDelete(o.id)} disabled={deleting === o.id} style={{ padding: '7px 12px', borderRadius: 7, background: '#fee2e2', color: '#ef4444', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{deleting === o.id ? '…' : 'Delete'}</button>
              </>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Portal
// ─────────────────────────────────────────────────────────────────────────────
export default function WholesalePortalClient({ session }: { session: WholesaleSession }) {
  const router = useRouter();

  // Settings
  const [browseMode, setBrowseMode]   = useState<'category' | 'product_type'>('category');
  const [portalTitle, setPortalTitle] = useState('Wholesale Portal');

  useEffect(() => {
    fetch('/api/wholesale/settings').then(r => r.json()).then(d => {
      if (d.success && d.data) {
        setBrowseMode(d.data.wholesale_browse_mode === 'product_type' ? 'product_type' : 'category');
        setPortalTitle(d.data.wholesale_portal_title || 'Wholesale Portal');
      }
    }).catch(() => {});
  }, []);

  // Products
  const [allProducts, setAllProducts]     = useState<WholesaleProduct[]>([]);
  const [categories, setCategories]       = useState<CategoryFacet[]>([]);
  const [productTypes, setProductTypes]   = useState<string[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError]     = useState('');

  useEffect(() => {
    setProductsLoading(true);
    fetch('/api/wholesale/products')
      .then(r => r.json())
      .then(d => {
        if (d.success) { setAllProducts(d.products ?? []); setCategories(d.facets?.categories ?? []); setProductTypes(d.facets?.productTypes ?? []); }
        else setProductsError(d.error ?? 'Failed to load products.');
      })
      .catch(() => setProductsError('Failed to load products.'))
      .finally(() => setProductsLoading(false));
  }, []);

  // Navigation
  const [view, setView]               = useState<PortalView>('shop');
  const [activeFilter, setActiveFilter] = useState<string>('__all');

  // Cart
  const [cartItems, setCartItems]   = useState<CartItem[]>(loadCart);
  const [cartOpen, setCartOpen]     = useState(false);
  const [cartNotes, setCartNotes]   = useState('');
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [saving, setSaving]         = useState(false);
  const [toastMsg, setToastMsg]     = useState('');

  const showToast = (msg: string) => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 3000); };
  useEffect(() => { saveCart(cartItems); }, [cartItems]);

  const cartQtyMap = cartItems.reduce<Record<string, number>>((acc, i) => { acc[i.variant_id] = (acc[i.variant_id] ?? 0) + i.qty; return acc; }, {});

  const handleAddToCart = (item: Omit<CartItem, 'is_indent'>) => {
    const isIndent = item.available <= 0 && item.allow_indent;
    setCartItems(prev => {
      const ex = prev.find(i => i.variant_id === item.variant_id);
      if (ex) return prev.map(i => { if (i.variant_id !== item.variant_id) return i; const n = i.qty + 1; return { ...i, qty: i.allow_indent ? n : Math.min(n, i.available) }; });
      return [...prev, { ...item, qty: 1, is_indent: isIndent }];
    });
    showToast(`Added: ${item.product_name} — ${item.variant_label}`);
  };

  const handleQtyChange = (vid: string, qty: number) => setCartItems(p => p.map(i => i.variant_id === vid ? { ...i, qty } : i));
  const handleRemove    = (vid: string) => setCartItems(p => p.filter(i => i.variant_id !== vid));
  const clearCart = () => { setCartItems([]); setCartNotes(''); setEditingOrderId(null); sessionStorage.removeItem(CART_KEY); };

  const handleSaveDraft = async () => {
    if (cartItems.length === 0) return;
    setSaving(true);
    try {
      const body = { notes: cartNotes, items: cartItems };
      if (editingOrderId) {
        const r = await fetch(`/api/wholesale/orders/${editingOrderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await r.json(); if (!d.success) throw new Error(d.error ?? 'Save failed');
      } else {
        const r = await fetch('/api/wholesale/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await r.json(); if (!d.success) throw new Error(d.error ?? 'Save failed');
        if (d.id) setEditingOrderId(d.id);
      }
      showToast('✓ Draft saved!'); setCartOpen(false);
    } catch (e: any) { showToast(`Error: ${e.message}`); }
    setSaving(false);
  };

  const handleSubmitOrder = async () => {
    if (cartItems.length === 0) return;
    if (!confirm('Submit this order? Our team will be in touch to confirm.')) return;
    setSaving(true);
    try {
      const body = { notes: cartNotes, items: cartItems };
      let orderId = editingOrderId;
      // First save/update the draft
      if (orderId) {
        const r = await fetch(`/api/wholesale/orders/${orderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await r.json(); if (!d.success) throw new Error(d.error ?? 'Save failed');
      } else {
        const r = await fetch('/api/wholesale/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await r.json(); if (!d.success) throw new Error(d.error ?? 'Save failed');
        orderId = d.id;
      }
      // Then submit — creates the IMS Sales Order, notification, and sends email
      const submitRes = await fetch(`/api/wholesale/orders/${orderId}/submit`, { method: 'POST' });
      const submitData = await submitRes.json();
      if (!submitData.success) throw new Error(submitData.error ?? 'Submit failed');
      showToast(`✓ Order submitted! Draft SO ${submitData.so_number} created — we'll be in touch.`);
      clearCart(); setCartOpen(false); setView('orders');
    } catch (e: any) { showToast(`Error: ${e.message}`); }
    setSaving(false);
  };

  const handleLoadDraft = async (id: number) => {
    try {
      const r = await fetch(`/api/wholesale/orders/${id}`); const d = await r.json();
      if (d.success && d.order) {
        // Build live stock map from the currently loaded catalogue
        const liveStockMap: Record<string, number> = {};
        for (const p of allProducts) {
          for (const v of (p.variants ?? [])) {
            liveStockMap[v.variant_id] = v.available ?? 0;
          }
        }
        setCartItems((d.order.items ?? []).map((item: any) => ({
          variant_id:    item.variant_id,
          product_id:    item.product_id,
          product_name:  item.product_name,
          variant_label: item.variant_label ?? '',
          sku:           item.sku ?? null,
          qty:           item.qty,
          unit_price:    Number(item.unit_price),
          available:     item.variant_id in liveStockMap ? liveStockMap[item.variant_id] : 9999,
          allow_indent:  !!item.is_indent,
          is_indent:     !!item.is_indent,
        })));
        setCartNotes(d.order.notes ?? ''); setEditingOrderId(id); setView('shop'); setCartOpen(true);
      }
    } catch { /* */ }
  };

  const handleLogout = async () => { await fetch('/api/wholesale/auth/logout', { method: 'POST' }); router.push('/wholesale/login'); };

  // Filtered products
  const filteredProducts = allProducts.filter(p => {
    if (activeFilter === '__all') return true;
    if (browseMode === 'category') { const [cat, sub] = activeFilter.split('||'); return sub ? p.category === cat && p.subcategory === sub : p.category === cat; }
    return p.product_type === activeFilter;
  });

  // Sidebar
  const SidebarItem = ({ id, label, indent }: { id: string; label: string; indent?: boolean }) => (
    <button onClick={() => setActiveFilter(id)} style={{ width: '100%', textAlign: 'left', padding: indent ? '6px 16px 6px 28px' : '7px 14px', background: activeFilter === id ? '#dbeafe' : 'transparent', color: activeFilter === id ? '#1d4ed8' : '#475569', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: activeFilter === id ? 700 : 400, borderLeft: activeFilter === id ? '3px solid #2563eb' : '3px solid transparent' }}>
      {label}
    </button>
  );

  const SidebarNav = () => {
    if (browseMode === 'category') {
      const tree: Record<string, string[]> = {};
      for (const f of categories) { if (!tree[f.category]) tree[f.category] = []; if (f.subcategory && !tree[f.category].includes(f.subcategory)) tree[f.category].push(f.subcategory); }
      return (
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <SidebarItem id="__all" label="All Products" />
          {Object.keys(tree).sort().map(cat => (
            <div key={cat}>
              <SidebarItem id={cat} label={cat} />
              {tree[cat].sort().map(sub => <SidebarItem key={`${cat}||${sub}`} id={`${cat}||${sub}`} label={sub} indent />)}
            </div>
          ))}
        </nav>
      );
    }
    return (
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <SidebarItem id="__all" label="All Products" />
        {productTypes.map(t => <SidebarItem key={t} id={t} label={t} />)}
      </nav>
    );
  };

  const cartCount = cartItems.reduce((s, i) => s + i.qty, 0);

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui,-apple-system,sans-serif' }}>
      {/* Toast */}
      {toastMsg && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, background: '#0f172a', color: '#f8fafc', padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 500, boxShadow: '0 4px 20px rgba(0,0,0,.25)' }}>
          {toastMsg}
        </div>
      )}

      {/* Cart Panel */}
      {cartOpen && <CartPanel items={cartItems} notes={cartNotes} onNotesChange={setCartNotes} onQtyChange={handleQtyChange} onRemove={handleRemove} onSaveDraft={handleSaveDraft} onSubmit={handleSubmitOrder} saving={saving} onClose={() => setCartOpen(false)} />}

      {/* Header */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,.06)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px', height: 60, display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, background: '#2563eb', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 28 28" fill="none"><path d="M14 2L24 7.5V20.5L14 26L4 20.5V7.5L14 2Z" fill="white" fillOpacity="0.15" stroke="white" strokeWidth="1.5"/><path d="M16.5 8H12L10.5 14H13.5L11.5 20L19 12.5H15L16.5 8Z" fill="white"/></svg>
            </div>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{portalTitle}</span>
          </div>
          <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
            {(['shop', 'orders'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: view === v ? '#dbeafe' : 'transparent', color: view === v ? '#1d4ed8' : '#64748b', fontWeight: view === v ? 700 : 500, fontSize: 13 }}>
                {v === 'shop' ? '🛍 Shop' : '📋 My Orders'}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => setCartOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px', background: cartCount > 0 ? '#2563eb' : '#f1f5f9', color: cartCount > 0 ? '#fff' : '#475569', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0"/></svg>
            Cart{cartCount > 0 ? ` (${cartCount})` : ''}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>{session.name || session.email}</div>
              {session.company && <div style={{ fontSize: 11, color: '#94a3b8' }}>{session.company}</div>}
            </div>
            <button onClick={handleLogout} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Sign Out</button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: 24 }}>
        {view === 'orders' ? (
          <DraftOrdersView onLoadDraft={handleLoadDraft} />
        ) : (
          <div style={{ display: 'flex', gap: 24 }}>
            {/* Sidebar */}
            <aside style={{ width: 210, flexShrink: 0, alignSelf: 'flex-start', position: 'sticky', top: 84 }}>
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 8px', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: .8, padding: '4px 6px 10px', borderBottom: '1px solid #f1f5f9', marginBottom: 6 }}>
                  {browseMode === 'category' ? 'Browse by Category' : 'Browse by Type'}
                </div>
                {productsLoading ? <div style={{ padding: '12px 10px', fontSize: 12, color: '#94a3b8' }}>Loading…</div> : <SidebarNav />}
              </div>
            </aside>

            {/* Grid */}
            <main style={{ flex: 1, minWidth: 0 }}>
              {productsError ? (
                <div style={{ padding: 24, color: '#ef4444', background: '#fef2f2', borderRadius: 10, border: '1px solid #fecaca' }}>{productsError}</div>
              ) : productsLoading ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
                  {Array.from({ length: 8 }).map((_, i) => <div key={i} style={{ background: '#fff', borderRadius: 12, height: 320, border: '1px solid #e2e8f0', opacity: .5 }} />)}
                </div>
              ) : filteredProducts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
                  <p style={{ fontSize: 14 }}>No products in this category.</p>
                  <button onClick={() => setActiveFilter('__all')} style={{ marginTop: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>View all →</button>
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 16, fontSize: 13, color: '#64748b' }}>
                    {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''}
                    {activeFilter !== '__all' && ` · ${activeFilter.split('||').join(' › ')}`}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16 }}>
                    {filteredProducts.map(p => <ProductCard key={p.product_id} product={p} onAdd={handleAddToCart} cartQtyMap={cartQtyMap} />)}
                  </div>
                </>
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}

