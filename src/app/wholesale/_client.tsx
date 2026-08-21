'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Heart, LayoutGrid, List, ListPlus } from 'lucide-react';
import type { WholesaleSession } from '@/lib/wholesale/wholesaleSession';
import type { WholesaleSupplierProfile } from '@/lib/wholesale/wholesaleSupplierProfile';
import type { WholesaleAccountProfile } from '@/lib/wholesale/wholesaleAccountProfile';
import { getWholesaleCartStorageKey, LEGACY_WHOLESALE_CART_KEY } from '@/lib/wholesale/wholesaleCartStorage';
import type { WholesaleQuickOrderItem } from '@/lib/wholesale/wholesaleQuickOrder';
import { buildWholesaleReorderCart } from '@/lib/wholesale/wholesaleReorder';
import { WholesalePortalShell, type WholesalePortalView } from './components/WholesalePortalShell';
import { WholesaleAccountView, WholesaleHelpView, WholesaleHomeView } from './components/WholesalePortalViews';
import { WholesaleOrdersView, type WholesaleOrderLine } from './components/WholesaleOrdersView';
import { WholesaleCartPanel, type WholesaleCartItem } from './components/WholesaleCartPanel';
import { WholesaleQuickOrderPanel } from './components/WholesaleQuickOrderPanel';
import { WholesaleProductDetail } from './components/WholesaleProductDetail';
import {
  WholesaleSavedListsView,
  type WholesaleSavedList,
  type WholesaleFavouriteDetail,
} from './components/WholesaleSavedListsView';
import catalogueStyles from './WholesaleCatalogue.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface WholesaleVariant {
  variant_id: string;
  product_id: string;
  sku: string | null;
  barcode: string | null;
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
  images?: string[];
  variants: WholesaleVariant[];
}

interface CategoryFacet { category: string; subcategory: string | null }

type CartItem = WholesaleCartItem;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmtCurrency = (n: number) =>
  `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function variantLabel(v: WholesaleVariant): string {
  return [v.option1_value, v.option2_value, v.option3_value].filter(Boolean).join(' / ') || 'Default';
}

function loadCart(storageKey: string | null): CartItem[] {
  if (typeof window === 'undefined') return [];
  sessionStorage.removeItem(LEGACY_WHOLESALE_CART_KEY);
  if (!storageKey) return [];
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    sessionStorage.removeItem(storageKey);
    return [];
  }
}
function saveCart(storageKey: string | null, items: CartItem[]) {
  if (typeof window === 'undefined' || !storageKey) return;
  if (items.length === 0) {
    sessionStorage.removeItem(storageKey);
    return;
  }
  sessionStorage.setItem(storageKey, JSON.stringify(items));
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
  product, onAdd, cartQtyMap, favouriteVariantIds, onToggleFavourite, onOpen, dense,
}: {
  product: WholesaleProduct;
  onAdd: (item: Omit<CartItem, 'is_indent' | 'indent_qty'>) => void;
  cartQtyMap: Record<string, number>;
  favouriteVariantIds: Set<string>;
  onToggleFavourite: (variantId: string) => void;
  onOpen: () => void;
  dense: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className={`${catalogueStyles.productCard} ${dense ? catalogueStyles.productCardDense : ''}`}>
      {/* Image */}
      <button className={catalogueStyles.productImage} onClick={onOpen} aria-label={`View ${product.name} details`}>
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
      </button>

      {/* Body */}
      <div style={{ padding: '14px 14px 6px', flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {product.brand && <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: .6 }}>{product.brand}</span>}
        <button className={catalogueStyles.productNameButton} onClick={onOpen}>{product.name}</button>
        {product.category && <span style={{ fontSize: 11, color: '#94a3b8' }}>{[product.category, product.subcategory].filter(Boolean).join(' › ')}</span>}
      </div>

      {/* Variants */}
      <div style={{ padding: '6px 14px 14px' }}>
        {(expanded ? product.variants : product.variants.slice(0, 3)).map(v => {
          const lbl = variantLabel(v);
          const inCart  = cartQtyMap[v.variant_id] ?? 0;
          const isOos   = v.available <= 0 && !product.allow_indent_wholesale;
          const isIndent = v.available <= 0 && !!product.allow_indent_wholesale;
          const favourite = favouriteVariantIds.has(v.variant_id);
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
              <button
                onClick={() => onToggleFavourite(v.variant_id)}
                aria-label={`${favourite ? 'Remove' : 'Add'} ${product.name} ${lbl} ${favourite ? 'from' : 'to'} favourites`}
                title={favourite ? 'Remove favourite' : 'Add favourite'}
                style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: 'none', background: 'transparent', color: favourite ? '#b8324b' : '#8b9991', cursor: 'pointer', flexShrink: 0 }}
              >
                <Heart size={16} fill={favourite ? 'currentColor' : 'none'} />
              </button>
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
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Portal
// ─────────────────────────────────────────────────────────────────────────────
export default function WholesalePortalClient({
  session,
  supplier,
  initialView = 'home',
}: {
  session: WholesaleSession;
  supplier: WholesaleSupplierProfile;
  initialView?: WholesalePortalView;
}) {
  const router = useRouter();
  const cartStorageKey = getWholesaleCartStorageKey({
    supplierSlug: supplier.slug,
    businessId: session.businessId,
    contactId: session.contactId,
    companyId: session.companyId,
    locationId: session.locationId,
    memberId: session.memberId,
  });

  // Settings
  const [browseMode, setBrowseMode]   = useState<'category' | 'product_type'>('category');

  useEffect(() => {
    fetch('/api/wholesale/settings').then(r => r.json()).then(d => {
      if (d.success && d.data) {
        setBrowseMode(d.data.wholesale_browse_mode === 'product_type' ? 'product_type' : 'category');
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
  const [view, setView]               = useState<WholesalePortalView>(initialView);
  const [activeFilter, setActiveFilter] = useState<string>('__all');
  const [accountProfile, setAccountProfile] = useState<WholesaleAccountProfile | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountError, setAccountError] = useState('');
  const [locationSwitching, setLocationSwitching] = useState(false);

  useEffect(() => {
    fetch('/api/wholesale/account')
      .then(async response => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || 'Account details could not be loaded.');
        setAccountProfile(body.profile);
      })
      .catch(error => setAccountError(error instanceof Error ? error.message : 'Account details could not be loaded.'))
      .finally(() => setAccountLoading(false));
  }, []);

  const handleViewChange = (nextView: WholesalePortalView) => {
    setView(nextView);
    const suffix = nextView === 'home' ? '' : `/${nextView}`;
    router.push(`/wholesale/${supplier.slug}${suffix}`);
  };

  const handleLocationChange = async (locationId: number) => {
    if (locationId === session.locationId || locationSwitching) return;
    setLocationSwitching(true);
    try {
      const response = await fetch('/api/wholesale/account/location', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locationId }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Buying location could not be switched.');
      window.location.reload();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Buying location could not be switched.');
      setLocationSwitching(false);
    }
  };

  // Search & brand filter
  const [searchQuery, setSearchQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState('__all');
  const [availabilityFilter, setAvailabilityFilter] = useState<'all' | 'available' | 'indent'>('all');
  const [catalogueViewMode, setCatalogueViewMode] = useState<'grid' | 'list'>('grid');

  const allBrands = React.useMemo(() => {
    const set = new Set<string>();
    for (const p of allProducts) { if (p.brand) set.add(p.brand); }
    return Array.from(set).sort();
  }, [allProducts]);

  // Cart
  const [cartItems, setCartItems]   = useState<CartItem[]>(() => loadCart(cartStorageKey));
  const [cartOpen, setCartOpen]     = useState(false);
  const [quickOrderOpen, setQuickOrderOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<WholesaleProduct | null>(null);
  const [favouriteVariantIds, setFavouriteVariantIds] = useState<Set<string>>(new Set());
  const [cartNotes, setCartNotes]   = useState('');
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [saving, setSaving]         = useState(false);
  const [toastMsg, setToastMsg]     = useState('');

  const showToast = (msg: string) => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 3000); };
  useEffect(() => { saveCart(cartStorageKey, cartItems); }, [cartItems, cartStorageKey]);

  useEffect(() => {
    fetch('/api/wholesale/saved-lists/favourites')
      .then(async response => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || 'Favourites could not be loaded.');
        setFavouriteVariantIds(new Set(body.variantIds ?? []));
      })
      .catch(() => showToast('Favourites could not be loaded.'));
  }, []);

  const cartQtyMap = cartItems.reduce<Record<string, number>>((acc, i) => { acc[i.variant_id] = (acc[i.variant_id] ?? 0) + i.qty; return acc; }, {});

  const handleAddToCart = (item: Omit<CartItem, 'is_indent' | 'indent_qty'>) => {
    setCartItems(prev => {
      const ex = prev.find(i => i.variant_id === item.variant_id);
      if (ex) return prev.map(i => { if (i.variant_id !== item.variant_id) return i; const qty = i.allow_indent ? i.qty + 1 : Math.min(i.qty + 1, i.available); const indentQty = Math.max(0, qty - i.available); return { ...i, qty, indent_qty: indentQty, is_indent: indentQty > 0 }; });
      const indentQty = Math.max(0, 1 - item.available);
      return [...prev, { ...item, qty: 1, indent_qty: indentQty, is_indent: indentQty > 0 }];
    });
    showToast(`Added: ${item.product_name} — ${item.variant_label}`);
  };

  const handleQtyChange = (vid: string, qty: number) => setCartItems(p => p.map(i => {
    if (i.variant_id !== vid) return i;
    const nextQty = i.allow_indent ? qty : Math.min(qty, i.available);
    const indentQty = Math.max(0, nextQty - i.available);
    return { ...i, qty: nextQty, indent_qty: indentQty, is_indent: indentQty > 0 };
  }));
  const handleRemove    = (vid: string) => setCartItems(p => p.filter(i => i.variant_id !== vid));
  const handleToggleFavourite = async (variantId: string) => {
    const favourite = !favouriteVariantIds.has(variantId);
    setFavouriteVariantIds(current => {
      const next = new Set(current);
      if (favourite) next.add(variantId); else next.delete(variantId);
      return next;
    });
    try {
      const response = await fetch('/api/wholesale/saved-lists/favourites', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId, favourite }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Favourite could not be updated.');
    } catch (error) {
      setFavouriteVariantIds(current => {
        const next = new Set(current);
        if (favourite) next.delete(variantId); else next.add(variantId);
        return next;
      });
      showToast(error instanceof Error ? error.message : 'Favourite could not be updated.');
    }
  };
  const clearCart = () => {
    setCartItems([]);
    setCartNotes('');
    setEditingOrderId(null);
    if (cartStorageKey) sessionStorage.removeItem(cartStorageKey);
  };

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

  const handleSubmitOrder = async (): Promise<string | null> => {
    if (cartItems.length === 0) return null;
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
      clearCart();
      return String(submitData.so_number);
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleLoadDraft = async (id: number) => {
    if (productsLoading) {
      showToast('Catalogue is still loading. Please try again.');
      return;
    }
    if (productsError) {
      showToast('Catalogue is unavailable, so this draft cannot be safely loaded.');
      return;
    }
    try {
      const response = await fetch(`/api/wholesale/orders/${id}`);
      const body = await response.json();
      if (!response.ok || !body.success || !body.order) throw new Error(body.error || 'Draft could not be loaded.');
      const requestedItems = (body.order.items ?? []).map((item: any) => ({
        variant_id: item.variant_id,
        qty_ordered: Number(item.qty),
      }));
      const { items, adjustedLines, unavailableLines } = buildWholesaleReorderCart(requestedItems, allProducts);
      if (items.length === 0) throw new Error('This draft no longer contains products available to your account.');

      setCartItems(items);
      setCartNotes(body.order.notes ?? '');
      setEditingOrderId(id);
      handleViewChange('catalogue');
      setCartOpen(true);
      const changes = [
        adjustedLines > 0 ? `${adjustedLines} adjusted for current stock` : '',
        unavailableLines > 0 ? `${unavailableLines} unavailable` : '',
      ].filter(Boolean);
      showToast(`Draft loaded at current pricing${changes.length ? `; ${changes.join(', ')}` : ''}.`);
    } catch (error) {
      showToast(`Error: ${error instanceof Error ? error.message : 'Draft could not be loaded.'}`);
    }
  };

  const handleReorder = (orderLines: WholesaleOrderLine[]) => {
    const { items: nextItems, adjustedLines, unavailableLines } = buildWholesaleReorderCart(orderLines, allProducts);

    if (nextItems.length === 0) {
      showToast(productsLoading ? 'Catalogue is still loading. Please try again.' : 'These products are no longer available to order.');
      return;
    }

    setCartItems(nextItems);
    setCartNotes('');
    setEditingOrderId(null);
    handleViewChange('catalogue');
    setCartOpen(true);
    const changes = [
      adjustedLines > 0 ? `${adjustedLines} adjusted for current stock` : '',
      unavailableLines > 0 ? `${unavailableLines} unavailable` : '',
    ].filter(Boolean);
    showToast(`Order added at current pricing${changes.length ? `; ${changes.join(', ')}` : ''}.`);
  };

  const handleUseSavedList = (list: WholesaleSavedList) => {
    const { items, adjustedLines, unavailableLines } = buildWholesaleReorderCart(
      list.items.map(item => ({ variant_id: item.variantId, qty_ordered: item.quantity })),
      allProducts,
    );
    if (items.length === 0) {
      showToast(productsLoading ? 'Catalogue is still loading. Please try again.' : 'These saved products are no longer available to order.');
      return;
    }
    setCartItems(items);
    setCartNotes('');
    setEditingOrderId(null);
    setCartOpen(true);
    const changes = [
      adjustedLines > 0 ? `${adjustedLines} adjusted for current stock` : '',
      unavailableLines > 0 ? `${unavailableLines} unavailable` : '',
    ].filter(Boolean);
    showToast(`${list.name} loaded at current pricing${changes.length ? `; ${changes.join(', ')}` : ''}.`);
  };

  const favouriteDetails = React.useMemo<WholesaleFavouriteDetail[]>(() => {
    const details: WholesaleFavouriteDetail[] = [];
    for (const product of allProducts) {
      for (const variant of product.variants) {
        if (!favouriteVariantIds.has(variant.variant_id)) continue;
        details.push({
          variantId: variant.variant_id,
          productName: product.name,
          variantLabel: variantLabel(variant),
          sku: variant.sku,
          price: Number(variant.price_wholesale),
          available: Number(variant.available),
          orderable: variant.available > 0 || !!product.allow_indent_wholesale,
        });
      }
    }
    return details;
  }, [allProducts, favouriteVariantIds]);

  const handleAddFavourite = (variantId: string) => {
    for (const product of allProducts) {
      const variant = product.variants.find(item => item.variant_id === variantId);
      if (!variant) continue;
      handleAddToCart({
        variant_id: variant.variant_id,
        product_id: product.product_id,
        product_name: product.name,
        variant_label: variantLabel(variant),
        sku: variant.sku,
        qty: 1,
        unit_price: variant.price_wholesale,
        available: variant.available,
        allow_indent: !!product.allow_indent_wholesale,
      });
      return;
    }
  };

  const handleQuickOrderAdd = (items: WholesaleQuickOrderItem[]) => {
    setCartItems(previous => {
      const next = [...previous];
      for (const item of items) {
        const index = next.findIndex(existing => existing.variant_id === item.variant_id);
        if (index < 0) {
          next.push({ ...item });
          continue;
        }
        const quantity = next[index].qty + item.qty;
        const indentQty = Math.max(0, quantity - item.available);
        next[index] = { ...next[index], ...item, qty: quantity, indent_qty: indentQty, is_indent: indentQty > 0 };
      }
      return next;
    });
    setQuickOrderOpen(false);
    setCartOpen(true);
    showToast(`${items.length} quick-order line${items.length === 1 ? '' : 's'} added at current pricing.`);
  };

  const handleLogout = async () => {
    clearCart();
    await fetch('/api/wholesale/auth/logout', { method: 'POST' });
    router.push(`/wholesale/${supplier.slug}`);
    router.refresh();
  };

  // Filtered products
  const filteredProducts = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allProducts.flatMap(p => {
      // Sidebar filter
      if (activeFilter !== '__all') {
        if (browseMode === 'category') {
          const [cat, sub] = activeFilter.split('||');
          if (sub ? p.category !== cat || p.subcategory !== sub : p.category !== cat) return [];
        } else {
          if (p.product_type !== activeFilter) return [];
        }
      }
      // Brand filter
      if (brandFilter !== '__all' && p.brand !== brandFilter) return [];
      // Search query — match product name, any variant SKU, any variant barcode
      if (q) {
        const nameMatch = p.name.toLowerCase().includes(q);
        const variantMatch = p.variants.some(
          v => (v.sku ?? '').toLowerCase().includes(q) || (v.barcode ?? '').toLowerCase().includes(q),
        );
        if (!nameMatch && !variantMatch) return [];
      }
      const variants = p.variants.filter(variant => {
        if (availabilityFilter === 'available') return variant.available > 0;
        if (availabilityFilter === 'indent') return variant.available <= 0 && !!p.allow_indent_wholesale;
        return true;
      });
      return variants.length > 0 ? [{ ...p, variants }] : [];
    });
  }, [allProducts, activeFilter, browseMode, brandFilter, searchQuery, availabilityFilter]);

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

  const browseOptions = browseMode === 'category'
    ? categories.flatMap(facet => [
        { id: facet.category, label: facet.category },
        ...(facet.subcategory ? [{ id: `${facet.category}||${facet.subcategory}`, label: `${facet.category} — ${facet.subcategory}` }] : []),
      ]).filter((option, index, options) => options.findIndex(candidate => candidate.id === option.id) === index)
    : productTypes.map(type => ({ id: type, label: type }));

  const cartCount = cartItems.reduce((s, i) => s + i.qty, 0);
  const cartValue = cartItems.reduce((sum, item) => sum + item.qty * item.unit_price, 0);

  return (
    <>
      {/* Toast */}
      {toastMsg && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, background: '#0f172a', color: '#f8fafc', padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 500, boxShadow: '0 4px 20px rgba(0,0,0,.25)' }}>
          {toastMsg}
        </div>
      )}

      {/* Cart Panel */}
      {cartOpen && (
        <WholesaleCartPanel
          items={cartItems}
          notes={cartNotes}
          profile={accountProfile}
          profileError={accountError}
          saving={saving}
          onNotesChange={setCartNotes}
          onQtyChange={handleQtyChange}
          onRemove={handleRemove}
          onSaveDraft={handleSaveDraft}
          onSubmit={handleSubmitOrder}
          onClose={() => setCartOpen(false)}
          onViewOrders={() => { setCartOpen(false); handleViewChange('orders'); }}
        />
      )}

      {quickOrderOpen && (
        <WholesaleQuickOrderPanel
          products={allProducts}
          existingQuantities={cartQtyMap}
          onAdd={handleQuickOrderAdd}
          onClose={() => setQuickOrderOpen(false)}
        />
      )}

      {selectedProduct && (
        <WholesaleProductDetail
          product={selectedProduct}
          favouriteVariantIds={favouriteVariantIds}
          cartQuantities={cartQtyMap}
          onToggleFavourite={variantId => void handleToggleFavourite(variantId)}
          onAdd={(variant, label) => handleAddToCart({
            variant_id: variant.variant_id,
            product_id: selectedProduct.product_id,
            product_name: selectedProduct.name,
            variant_label: label,
            sku: variant.sku,
            qty: 1,
            unit_price: variant.price_wholesale,
            available: variant.available,
            allow_indent: !!selectedProduct.allow_indent_wholesale,
          })}
          onClose={() => setSelectedProduct(null)}
        />
      )}

      <WholesalePortalShell
        supplier={supplier}
        session={session}
        view={view}
        searchQuery={searchQuery}
        cartCount={cartCount}
        cartValue={cartValue}
        locationName={accountProfile?.location.name}
        locations={accountProfile?.locations}
        locationId={accountProfile?.location.id}
        locationSwitching={locationSwitching}
        onViewChange={handleViewChange}
        onSearchChange={setSearchQuery}
        onCartOpen={() => setCartOpen(true)}
        onLocationChange={handleLocationChange}
        onLogout={handleLogout}
      >
        {view === 'home' ? (
          <WholesaleHomeView
            session={session}
            productCount={allProducts.length}
            cartCount={cartCount}
            draftActive={editingOrderId !== null}
            accountProfile={accountProfile}
            onNavigate={handleViewChange}
            onCartOpen={() => setCartOpen(true)}
          />
        ) : view === 'account' ? (
          <WholesaleAccountView
            session={session}
            profile={accountProfile}
            loading={accountLoading}
            error={accountError}
            onProfileChange={setAccountProfile}
          />
        ) : view === 'help' ? (
          <WholesaleHelpView supplier={supplier} />
        ) : view === 'orders' ? (
          <WholesaleOrdersView
            activeDraftId={editingOrderId}
            cartItemCount={cartItems.length}
            onContinueDraft={() => setCartOpen(true)}
            onLoadDraft={handleLoadDraft}
            onReorder={handleReorder}
          />
        ) : view === 'lists' ? (
          <WholesaleSavedListsView
            cartItems={cartItems}
            favouriteDetails={favouriteDetails}
            onUseList={handleUseSavedList}
            onAddFavouriteToCart={handleAddFavourite}
            onRemoveFavourite={variantId => void handleToggleFavourite(variantId)}
            onBrowse={() => handleViewChange('catalogue')}
            onNotice={showToast}
          />
        ) : (
          <div className={catalogueStyles.layout}>
            {/* Sidebar */}
            <aside className={catalogueStyles.sidebar}>
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 8px', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: .8, padding: '4px 6px 10px', borderBottom: '1px solid #f1f5f9', marginBottom: 6 }}>
                  {browseMode === 'category' ? 'Browse by Category' : 'Browse by Type'}
                </div>
                {productsLoading ? <div style={{ padding: '12px 10px', fontSize: 12, color: '#94a3b8' }}>Loading…</div> : <SidebarNav />}
              </div>
            </aside>

            {/* Grid */}
            <div className={catalogueStyles.grid}>
              {/* Browse & brand filters */}
              <div className={catalogueStyles.filters}>
                <div className={catalogueStyles.mobileBrowse}>
                  <select
                    aria-label={browseMode === 'category' ? 'Browse by category' : 'Browse by type'}
                    value={activeFilter}
                    onChange={event => setActiveFilter(event.target.value)}
                    style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #d7ddd7', background: '#fff', fontSize: 13, color: '#26332c' }}
                  >
                    <option value="__all">All products</option>
                    {browseOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </div>
                {allBrands.length > 0 && (
                  <select
                    value={brandFilter}
                    onChange={e => setBrandFilter(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', fontSize: 13, color: brandFilter === '__all' ? '#94a3b8' : '#0f172a', flexShrink: 0, cursor: 'pointer' }}
                  >
                    <option value="__all">All Brands</option>
                    {allBrands.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                )}
                <select className={catalogueStyles.filterSelect} aria-label="Availability" value={availabilityFilter} onChange={event => setAvailabilityFilter(event.target.value as typeof availabilityFilter)}>
                  <option value="all">All availability</option>
                  <option value="available">Available now</option>
                  <option value="indent">Indent only</option>
                </select>
                {(searchQuery || brandFilter !== '__all' || activeFilter !== '__all' || availabilityFilter !== 'all') && (
                  <button onClick={() => { setSearchQuery(''); setBrandFilter('__all'); setActiveFilter('__all'); setAvailabilityFilter('all'); }} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#64748b', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>Clear</button>
                )}
                <div className={catalogueStyles.viewToggle} aria-label="Catalogue layout">
                  <button className={catalogueViewMode === 'grid' ? catalogueStyles.viewActive : ''} onClick={() => setCatalogueViewMode('grid')} aria-label="Grid view" title="Grid view"><LayoutGrid size={15} /></button>
                  <button className={catalogueViewMode === 'list' ? catalogueStyles.viewActive : ''} onClick={() => setCatalogueViewMode('list')} aria-label="List view" title="List view"><List size={15} /></button>
                </div>
                <button className={catalogueStyles.quickOrderButton} onClick={() => setQuickOrderOpen(true)} disabled={productsLoading || !!productsError}><ListPlus size={15} /> Quick order</button>
              </div>
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
                  <div className={catalogueViewMode === 'grid' ? catalogueStyles.productGrid : catalogueStyles.productList}>
                    {filteredProducts.map(p => <ProductCard key={p.product_id} product={p} onAdd={handleAddToCart} cartQtyMap={cartQtyMap} favouriteVariantIds={favouriteVariantIds} onToggleFavourite={variantId => void handleToggleFavourite(variantId)} onOpen={() => setSelectedProduct(p)} dense={catalogueViewMode === 'list'} />)}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </WholesalePortalShell>
    </>
  );
}

