'use client';
import { useEffect, useState, useCallback } from 'react';

// ─── helpers ──────────────────────────────────────────────────────────────────
function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', border: 'none', borderRadius: 6, cursor: 'pointer',
    fontSize: 13, fontWeight: active ? 600 : 400,
    background: active ? 'var(--sv-action)' : 'var(--sv-bg-2)',
    color: active ? '#fff' : 'var(--sv-text-main)',
  };
}
function statusBadge(s: 'success' | 'error' | 'partial' | string) {
  const colours: Record<string, { bg: string; fg: string }> = {
    success: { bg: 'rgba(16,185,129,.15)', fg: '#34d399' },
    error:   { bg: 'rgba(248,113,113,.15)', fg: '#f87171' },
    partial: { bg: 'rgba(251,191,36,.15)',  fg: '#fbbf24' },
  };
  const c = colours[s] ?? colours.partial;
  return (
    <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: c.bg, color: c.fg }}>
      {s}
    </span>
  );
}
function actionLabel(a: string) {
  return { reconcile: 'Reconcile', upload: 'Upload', sync_prices: 'Sync Prices', resync: 'Full Resync' }[a] ?? a;
}

// ─── Main ShopifyView ─────────────────────────────────────────────────────────
export default function ShopifyView({ businessId }: { businessId?: string }) {
  const [status, setStatus]   = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<'overview' | 'products' | 'log' | 'orders'>('overview');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/ims/shopify/status');
      setStatus(await r.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  if (loading) return <div style={{ padding: 40, color: 'var(--sv-text-dim)' }}>Loading Shopify status…</div>;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--sv-text-strong)' }}>Shopify Integration</h1>
        <span style={{
          padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
          background: status?.connected ? 'rgba(16,185,129,.15)' : 'rgba(248,113,113,.15)',
          color: status?.connected ? '#34d399' : '#f87171',
        }}>
          {status?.connected ? `Connected — ${status.shop_domain}` : 'Not Connected'}
        </span>
      </div>

      {!status?.connected ? (
        <div style={{ padding: 24, background: 'var(--sv-bg-2)', borderRadius: 10, border: '1px solid var(--sv-etch)' }}>
          <p style={{ color: 'var(--sv-text-main)', margin: '0 0 16px', lineHeight: 1.6 }}>
            Shopify credentials are not configured. Go to <strong>Setup → Connections</strong> and enter your Shopify Store URL and Access Token.
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            <button style={tabBtnStyle(tab === 'overview')} onClick={() => setTab('overview')}>Overview</button>
            <button style={tabBtnStyle(tab === 'products')} onClick={() => setTab('products')}>Products</button>
            <button style={tabBtnStyle(tab === 'log')}      onClick={() => setTab('log')}>Sync Log</button>
            <button style={tabBtnStyle(tab === 'orders')}   onClick={() => setTab('orders')}>Orders & Webhooks</button>
          </div>
          {tab === 'overview' && <ShopifyOverviewTab status={status} onReload={reload} />}
          {tab === 'products' && <ShopifyProductsTab />}
          {tab === 'log'      && <ShopifyLogTab />}
          {tab === 'orders'   && <ShopifyOrdersTab businessId={businessId ?? ''} />}
        </>
      )}
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function ShopifyOverviewTab({ status, onReload }: { status: any; onReload: () => void }) {
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<any>(null);
  const [reconcileError, setReconcileError]   = useState<string | null>(null);
  const [importingImages, setImportingImages] = useState(false);
  const [importResult, setImportResult]       = useState<string | null>(null);

  const runReconcile = async () => {
    setReconciling(true);
    setReconcileResult(null);
    setReconcileError(null);
    try {
      const r = await fetch('/api/ims/shopify/reconcile', { method: 'POST' });
      const data = await r.json();
      if (!data.success) throw new Error(data.error);
      setReconcileResult(data);
      onReload();
    } catch (e: any) {
      setReconcileError(e.message);
    }
    setReconciling(false);
  };

  const runImportImages = async () => {
    setImportingImages(true); setImportResult(null);
    try {
      const r = await fetch('/api/ims/shopify/import-images', { method: 'POST' });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setImportResult(`Imported images for ${d.imported} products (${d.skipped} skipped).`);
    } catch (e: any) { setImportResult(`Error: ${e.message}`); }
    setImportingImages(false);
  };

  const card: React.CSSProperties = {
    padding: 20, background: 'var(--sv-bg-2)', borderRadius: 10,
    border: '1px solid var(--sv-etch)',
  };
  const label: React.CSSProperties = { fontSize: 12, color: 'var(--sv-text-dim)', marginBottom: 4 };
  const value: React.CSSProperties = { fontSize: 24, fontWeight: 700, color: 'var(--sv-text-strong)' };

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <div style={card}>
          <div style={label}>Linked to Shopify</div>
          <div style={value}>{status.linked ?? 0}</div>
        </div>
        <div style={card}>
          <div style={label}>Not yet in Shopify</div>
          <div style={{ ...value, color: status.notInShopify > 0 ? '#fbbf24' : 'var(--sv-text-strong)' }}>
            {status.notInShopify ?? 0}
          </div>
        </div>
        <div style={card}>
          <div style={label}>Total IMS Products</div>
          <div style={value}>{status.total ?? 0}</div>
        </div>
      </div>

      {/* Reconcile card */}
      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: 'var(--sv-text-strong)' }}>Reconcile Existing Products</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--sv-text-main)', lineHeight: 1.6 }}>
          Matches IMS products to your existing Shopify catalog by SKU or barcode.
          This links them so price syncs work correctly. Run this once to connect products already in Shopify.
        </p>
        <button
          onClick={runReconcile}
          disabled={reconciling}
          style={{
            padding: '9px 20px', background: 'var(--sv-action)', color: '#fff',
            border: 'none', borderRadius: 6, cursor: reconciling ? 'not-allowed' : 'pointer',
            fontWeight: 600, fontSize: 14, opacity: reconciling ? 0.7 : 1,
          }}
        >
          {reconciling ? 'Reconciling…' : '🔗 Reconcile Now'}
        </button>

        {reconcileResult && (
          <div style={{ marginTop: 16, padding: 14, background: 'rgba(16,185,129,.08)', borderRadius: 8, border: '1px solid rgba(16,185,129,.25)', fontSize: 13 }}>
            <strong style={{ color: '#34d399' }}>✓ Reconcile complete</strong>
            <div style={{ marginTop: 6, color: 'var(--sv-text-main)', lineHeight: 1.8 }}>
              <div>Shopify products fetched: <strong>{reconcileResult.shopify_products_fetched}</strong></div>
              <div>Matched: <strong>{reconcileResult.matched}</strong> variants</div>
              <div>IMS with no Shopify match: <strong>{reconcileResult.unmatched_ims}</strong></div>
              <div>Shopify with no IMS match: <strong>{reconcileResult.unmatched_shopify}</strong></div>
              {reconcileResult.unmatched_ims_samples?.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--sv-text-dim)' }}>Unmatched IMS SKUs (first 20)</summary>
                  <pre style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--sv-text-dim)', whiteSpace: 'pre-wrap' }}>
                    {reconcileResult.unmatched_ims_samples.join('\n')}
                  </pre>
                </details>
              )}
            </div>
          </div>
        )}

        {reconcileError && (
          <div style={{ marginTop: 16, padding: 12, background: 'rgba(248,113,113,.1)', borderRadius: 8, border: '1px solid rgba(248,113,113,.3)', color: '#f87171', fontSize: 13 }}>
            ✗ {reconcileError}
          </div>
        )}
      </div>

      {/* Import images card */}
      <div style={{ ...card, marginTop: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: 'var(--sv-text-strong)' }}>Import Product Images from Shopify</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--sv-text-main)', lineHeight: 1.6 }}>
          Pulls Shopify CDN image URLs for all linked products into IMS. Run after Reconcile.
          Images are stored as URLs — nothing is downloaded.
        </p>
        <button
          onClick={runImportImages}
          disabled={importingImages}
          style={{
            padding: '9px 20px', background: 'var(--sv-bg-2)', color: 'var(--sv-text-main)',
            border: '1px solid var(--sv-etch)', borderRadius: 6, cursor: importingImages ? 'not-allowed' : 'pointer',
            fontWeight: 600, fontSize: 14, opacity: importingImages ? 0.7 : 1,
          }}
        >
          {importingImages ? 'Importing…' : '🖼 Import Images'}
        </button>
        {importResult && (
          <div style={{ marginTop: 12, fontSize: 13, color: importResult.startsWith('Error') ? '#f87171' : '#34d399' }}>
            {importResult.startsWith('Error') ? '✗' : '✓'} {importResult}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Products Tab ─────────────────────────────────────────────────────────────
function ShopifyProductsTab() {
  const [products, setProducts]   = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [segment, setSegment]     = useState<'not_in_shopify' | 'linked' | 'all'>('not_in_shopify');
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [search, setSearch]       = useState('');
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing]     = useState(false);
  const [opResult, setOpResult]   = useState<string | null>(null);
  const [opError, setOpError]     = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/ims/shopify/products');
      const d = await r.json();
      if (d.success) {
        setProducts(d.data ?? []);
        // Auto-select all not-in-shopify products
        const ids = new Set<string>((d.data ?? []).filter((p: any) => p.shopify_status === 'not_in_shopify').map((p: any) => p.product_id));
        setSelected(ids);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const filtered = products.filter(p => {
    if (segment !== 'all' && p.shopify_status !== segment) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.name?.toLowerCase().includes(q) || p.brand?.toLowerCase().includes(q);
    }
    return true;
  });

  const allFilteredIds = filtered.map(p => p.product_id);
  const allSelected    = allFilteredIds.length > 0 && allFilteredIds.every(id => selected.has(id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(prev => { const next = new Set(prev); allFilteredIds.forEach(id => next.delete(id)); return next; });
    } else {
      setSelected(prev => { const next = new Set(prev); allFilteredIds.forEach(id => next.add(id)); return next; });
    }
  };

  const runUpload = async () => {
    const ids = [...selected].filter(id => products.find(p => p.product_id === id && p.shopify_status === 'not_in_shopify'));
    if (!ids.length) { setOpError('No unlinked products selected.'); return; }
    setUploading(true); setOpResult(null); setOpError(null);
    try {
      const r = await fetch('/api/ims/shopify/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_ids: ids }) });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setOpResult(`Uploaded ${d.uploaded}/${d.total} products to Shopify.`);
      await fetchProducts();
    } catch (e: any) { setOpError(e.message); }
    setUploading(false);
  };

  const runSyncPrices = async () => {
    const ids = [...selected].filter(id => products.find(p => p.product_id === id && p.shopify_status === 'linked'));
    if (!ids.length) { setOpError('No linked products selected.'); return; }
    setSyncing(true); setOpResult(null); setOpError(null);
    try {
      const r = await fetch('/api/ims/shopify/sync-prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_ids: ids }) });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setOpResult(`Synced prices for ${d.synced}/${d.total} variants.`);
    } catch (e: any) { setOpError(e.message); }
    setSyncing(false);
  };

  const runResync = async () => {
    setSyncing(true); setOpResult(null); setOpError(null);
    try {
      const r = await fetch('/api/ims/shopify/sync-prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setOpResult(`Full resync complete: ${d.synced}/${d.total} variants.`);
    } catch (e: any) { setOpError(e.message); }
    setSyncing(false);
  };

  const segBtn = (s: typeof segment, label: string, count?: number) => (
    <button
      onClick={() => setSegment(s)}
      style={{
        padding: '6px 14px', border: '1px solid var(--sv-etch)', borderRadius: 6, cursor: 'pointer',
        fontSize: 12, fontWeight: segment === s ? 600 : 400,
        background: segment === s ? 'var(--sv-action)' : 'transparent',
        color: segment === s ? '#fff' : 'var(--sv-text-main)',
      }}
    >
      {label}{count !== undefined ? ` (${count})` : ''}
    </button>
  );

  const notInShopifyCount = products.filter(p => p.shopify_status === 'not_in_shopify').length;
  const linkedCount       = products.filter(p => p.shopify_status === 'linked').length;

  if (loading) return <div style={{ padding: 40, color: 'var(--sv-text-dim)' }}>Loading products…</div>;

  return (
    <div>
      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {segBtn('not_in_shopify', 'Not in Shopify', notInShopifyCount)}
          {segBtn('linked', 'Linked', linkedCount)}
          {segBtn('all', 'All', products.length)}
        </div>
        <input
          type="text" placeholder="Search name or brand…" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 160, height: 34, padding: '0 10px', fontSize: 13, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-2)', color: 'var(--sv-text-main)' }}
        />
        <button
          onClick={runUpload} disabled={uploading || syncing}
          style={{ padding: '7px 16px', background: 'var(--sv-action)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13, opacity: uploading ? 0.7 : 1 }}
        >
          {uploading ? 'Uploading…' : '⬆ Upload Selected'}
        </button>
        <button
          onClick={runSyncPrices} disabled={syncing || uploading}
          style={{ padding: '7px 16px', background: 'var(--sv-bg-2)', color: 'var(--sv-text-main)', border: '1px solid var(--sv-etch)', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13, opacity: syncing ? 0.7 : 1 }}
        >
          {syncing ? 'Syncing…' : '💲 Sync Prices'}
        </button>
        <button
          onClick={runResync} disabled={syncing || uploading}
          style={{ padding: '7px 16px', background: 'var(--sv-bg-2)', color: 'var(--sv-text-main)', border: '1px solid var(--sv-etch)', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13, opacity: syncing ? 0.7 : 1 }}
        >
          {syncing ? 'Syncing…' : '🔄 Full Resync'}
        </button>
      </div>

      {/* Result / error banner */}
      {opResult && (
        <div style={{ marginBottom: 12, padding: '10px 14px', background: 'rgba(16,185,129,.1)', borderRadius: 8, border: '1px solid rgba(16,185,129,.25)', color: '#34d399', fontSize: 13 }}>
          ✓ {opResult}
        </div>
      )}
      {opError && (
        <div style={{ marginBottom: 12, padding: '10px 14px', background: 'rgba(248,113,113,.1)', borderRadius: 8, border: '1px solid rgba(248,113,113,.3)', color: '#f87171', fontSize: 13 }}>
          ✗ {opError}
        </div>
      )}

      {/* Table */}
      <div style={{ border: '1px solid var(--sv-etch)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--sv-bg-2)', borderBottom: '1px solid var(--sv-etch)' }}>
              <th style={{ width: 40, padding: '10px 12px' }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--sv-text-dim)', fontWeight: 600 }}>Product</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--sv-text-dim)', fontWeight: 600 }}>Brand</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--sv-text-dim)', fontWeight: 600 }}>Variants</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--sv-text-dim)', fontWeight: 600 }}>Price from</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--sv-text-dim)', fontWeight: 600 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--sv-text-dim)' }}>No products found.</td></tr>
            )}
            {filtered.map(p => {
              const minPrice = (p.variants ?? []).reduce((min: number | null, v: any) => {
                const pr = Number(v.price ?? 0);
                return min === null ? pr : Math.min(min, pr);
              }, null);
              return (
                <tr key={p.product_id} style={{ borderBottom: '1px solid var(--sv-etch)', background: selected.has(p.product_id) ? 'rgba(37,99,235,.05)' : undefined }}>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={selected.has(p.product_id)}
                      onChange={() => {
                        setSelected(prev => { const next = new Set(prev); next.has(p.product_id) ? next.delete(p.product_id) : next.add(p.product_id); return next; });
                      }}
                    />
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--sv-text-main)', fontWeight: 500 }}>{p.name}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--sv-text-dim)' }}>{p.brand ?? '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--sv-text-dim)' }}>{(p.variants ?? []).length}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--sv-text-dim)' }}>
                    {minPrice !== null ? `$${minPrice.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {p.shopify_status === 'linked'
                      ? <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: 'rgba(16,185,129,.15)', color: '#34d399' }}>Linked</span>
                      : <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: 'rgba(251,191,36,.15)', color: '#fbbf24' }}>Not in Shopify</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--sv-text-dim)' }}>
        {selected.size} selected · {filtered.length} shown
      </div>
    </div>
  );
}

// ─── Sync Log Tab ─────────────────────────────────────────────────────────────
function ShopifyLogTab() {
  const [log, setLog]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/ims/shopify/sync-log');
        const d = await r.json();
        if (d.success) setLog(d.data ?? []);
      } catch {}
      setLoading(false);
    })();
  }, []);

  if (loading) return <div style={{ padding: 40, color: 'var(--sv-text-dim)' }}>Loading log…</div>;

  return (
    <div style={{ border: '1px solid var(--sv-etch)', borderRadius: 10, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--sv-bg-2)', borderBottom: '1px solid var(--sv-etch)' }}>
            <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--sv-text-dim)', fontWeight: 600 }}>Date / Time</th>
            <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--sv-text-dim)', fontWeight: 600 }}>Action</th>
            <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--sv-text-dim)', fontWeight: 600 }}>Summary</th>
            <th style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--sv-text-dim)', fontWeight: 600 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {log.length === 0 && (
            <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: 'var(--sv-text-dim)' }}>No sync history yet.</td></tr>
          )}
          {log.map(row => (
            <tr key={row.id} style={{ borderBottom: '1px solid var(--sv-etch)' }}>
              <td style={{ padding: '10px 12px', color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>
                {new Date(row.created_at).toLocaleString()}
              </td>
              <td style={{ padding: '10px 12px', color: 'var(--sv-text-main)', fontWeight: 500 }}>
                {actionLabel(row.action)}
              </td>
              <td style={{ padding: '10px 12px', color: 'var(--sv-text-dim)' }}>{row.summary}</td>
              <td style={{ padding: '10px 12px', textAlign: 'center' }}>{statusBadge(row.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Orders & Webhooks Tab ────────────────────────────────────────────────────
function ShopifyOrdersTab({ businessId }: { businessId: string }) {
  const [syncFrom,       setSyncFrom]       = useState('2026-07-01');
  const [locationId,     setLocationId]     = useState('');
  const [webhookSecret,  setWebhookSecret]  = useState('');
  const [locations,      setLocations]      = useState<{ id: number; name: string }[]>([]);
  const [saving,         setSaving]         = useState(false);
  const [saveMsg,        setSaveMsg]        = useState<string | null>(null);
  const [syncEnabled,    setSyncEnabled]    = useState(false);
  const [importing,      setImporting]      = useState(false);
  const [importResult,   setImportResult]   = useState<any>(null);
  const [importError,    setImportError]    = useState<string | null>(null);

  useEffect(() => {
    // Load current settings
    fetch('/api/ims/settings').then(r => r.json()).then(d => {
      if (d.data) {
        if (d.data.shopify_order_sync_from) setSyncFrom(d.data.shopify_order_sync_from);
        if (d.data.online_sales_location_id) setLocationId(d.data.online_sales_location_id);
        if (d.data.shopify_webhook_secret) setWebhookSecret(d.data.shopify_webhook_secret);
        setSyncEnabled(d.data.shopify_order_sync_enabled === '1');
      }
    }).catch(() => {});
    // Load locations
    fetch('/api/ims/locations').then(r => r.json()).then(d => {
      if (d.success) setLocations(d.data ?? []);
    }).catch(() => {});
  }, []);

  async function saveSettings() {
    setSaving(true); setSaveMsg(null);
    try {
      await fetch('/api/ims/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: {
          shopify_order_sync_enabled: syncEnabled ? '1' : '0',
          shopify_order_sync_from: syncFrom,
          online_sales_location_id: locationId,
          shopify_webhook_secret: webhookSecret,
        }}),
      });
      setSaveMsg('Settings saved.');
    } catch (e: any) { setSaveMsg(`Error: ${e.message}`); }
    setSaving(false);
  }

  async function runImport() {
    setImporting(true); setImportResult(null); setImportError(null);
    try {
      const r = await fetch('/api/ims/shopify/import-orders', { method: 'POST' });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error ?? 'Import failed');
      setImportResult(d);
    } catch (e: any) { setImportError(e.message); }
    setImporting(false);
  }

  const card: React.CSSProperties = { padding: 20, background: 'var(--sv-bg-2)', borderRadius: 10, border: '1px solid var(--sv-etch)', marginBottom: 16 };
  const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' };
  const input: React.CSSProperties = { padding: '7px 10px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', fontSize: 13, width: '100%', boxSizing: 'border-box' as const };
  const btn = (primary?: boolean): React.CSSProperties => ({ padding: '8px 20px', background: primary ? 'var(--sv-action)' : 'var(--sv-bg-1)', color: primary ? '#fff' : 'var(--sv-text-main)', border: `1px solid ${primary ? 'transparent' : 'var(--sv-etch)'}`, borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 });

  const webhookUrl = (typeof window !== 'undefined' ? window.location.origin : '') + `/api/webhooks/shopify/orders/${businessId}`;

  return (
    <div>
      {/* Enable/Disable toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, padding: '14px 18px', background: syncEnabled ? 'rgba(16,185,129,.08)' : 'var(--sv-bg-2)', border: `1px solid ${syncEnabled ? 'rgba(16,185,129,.3)' : 'var(--sv-etch)'}`, borderRadius: 10 }}>
        <div
          onClick={async () => {
            const next = !syncEnabled;
            setSyncEnabled(next);
            await fetch('/api/ims/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { shopify_order_sync_enabled: next ? '1' : '0' } }) }).catch(() => {});
          }}
          style={{ width: 48, height: 26, borderRadius: 99, background: syncEnabled ? '#10b981' : 'var(--sv-etch)', position: 'relative', cursor: 'pointer', transition: 'background .2s', flexShrink: 0 }}
        >
          <div style={{ position: 'absolute', top: 3, left: syncEnabled ? 25 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 4px rgba(0,0,0,.3)' }} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: syncEnabled ? '#10b981' : 'var(--sv-text-dim)' }}>
            Shopify Order Sync {syncEnabled ? 'Enabled' : 'Disabled'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--sv-text-dim)', marginTop: 2 }}>
            {syncEnabled
              ? 'Webhook events and manual imports are active. New Shopify orders will flow into IMS automatically.'
              : 'Sync is off. Webhook calls will be accepted but silently ignored. Manual import is also blocked.'}
          </div>
        </div>
      </div>
      <div style={card}>
        <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: 'var(--sv-text-strong)' }}>Order Sync Configuration</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={label}>Transition Date (sync orders from)</label>
            <input type="date" value={syncFrom} onChange={e => setSyncFrom(e.target.value)} style={input} />
            <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginTop: 4 }}>Orders before this date were imported from Cin7 and should not be re-imported.</div>
          </div>
          <div>
            <label style={label}>Online Orders Location (warehouse)</label>
            <select value={locationId} onChange={e => setLocationId(e.target.value)} style={input}>
              <option value="">— Select —</option>
              {locations.map(l => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginTop: 4 }}>Which location's stock is committed/deducted for online orders.</div>
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={label}>Shopify Webhook Signing Secret</label>
          <input type="password" value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)} placeholder="shpss_…" style={input} autoComplete="new-password" />
          <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginTop: 4 }}>Found in Shopify Admin → Settings → Notifications → Webhooks → your webhook → Signing secret.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={saveSettings} disabled={saving} style={btn(true)}>{saving ? 'Saving…' : 'Save Settings'}</button>
          {saveMsg && <span style={{ fontSize: 13, color: saveMsg.startsWith('Error') ? 'var(--sv-red)' : 'var(--sv-mint)' }}>{saveMsg}</span>}
        </div>
      </div>

      {/* Webhook URL */}
      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: 'var(--sv-text-strong)' }}>Webhook URL</h3>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--sv-text-main)', lineHeight: 1.6 }}>
          Add this URL in <strong>Shopify Admin → Settings → Notifications → Webhooks</strong> for <strong>each</strong> of the following events. All should use the same URL and the same signing secret.
        </p>
        <div style={{ marginBottom: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12 }}>
          {[
            ['orders/create',      'New order placed — imports the order into IMS'],
            ['orders/updated',     'Order edited — updates prices/totals in IMS'],
            ['orders/cancelled',   'Order cancelled — releases committed stock'],
            ['fulfillments/create','Order fulfilled — moves stock to fulfilled'],
            ['refunds/create',     'Refund issued — covers all refund + restock scenarios'],
          ].map(([topic, desc]) => (
            <div key={topic} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <code style={{ flexShrink: 0, padding: '1px 6px', background: 'var(--sv-bg-0)', borderRadius: 4, fontSize: 11, color: 'var(--sv-mint)', border: '1px solid var(--sv-etch)' }}>{topic}</code>
              <span style={{ color: 'var(--sv-text-dim)', fontSize: 11, lineHeight: 1.5 }}>{desc}</span>
            </div>
          ))}
        </div>
        <div style={{ marginBottom: 10, padding: '7px 10px', background: 'rgba(251,191,36,.07)', borderRadius: 6, fontSize: 11, color: 'var(--sv-text-dim)', lineHeight: 1.6 }}>
          <strong style={{ color: '#fbbf24' }}>ℹ Returns webhooks</strong> — Shopify's <code style={{ fontFamily: 'monospace', fontSize: 10 }}>returns/*</code> topics require the <code style={{ fontFamily: 'monospace', fontSize: 10 }}>returns</code> access scope, a Shopify/Advanced/Plus plan, and must be registered via the Shopify Admin API (they don't appear in the UI dropdown). <strong>You don't need them</strong> — <code style={{ fontFamily: 'monospace', fontSize: 10 }}>refunds/create</code> already handles every refund and restock scenario. If you want to track a physical return before money is refunded, you can mark a credit note as <em>Awaiting product</em> manually in IMS → Credit Notes / Returns.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <code style={{ flex: 1, padding: '8px 12px', background: 'var(--sv-bg-1)', borderRadius: 6, border: '1px solid var(--sv-etch)', fontSize: 12, color: 'var(--sv-mint)', overflowX: 'auto' as const }}>{webhookUrl}</code>
          <button onClick={() => navigator.clipboard?.writeText(webhookUrl)} style={btn()}>Copy</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--sv-text-dim)', lineHeight: 1.6 }}>
          After adding each webhook in Shopify, paste the <strong>Signing secret</strong> (shown per-webhook in Shopify) into the Settings field above. All webhooks registered at the same URL share one secret.
        </div>

        {/* Webhook status checker */}
        <WebhookStatusChecker btn={btn} />
      </div>

      {/* Manual import */}
      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: 'var(--sv-text-strong)' }}>Manual Order Import</h3>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--sv-text-main)', lineHeight: 1.6 }}>
          Pulls all Shopify orders from the transition date to now and imports them into IMS. Safe to run multiple times — existing orders are skipped. Also backfills any refunds already recorded on those orders.
        </p>
        <div style={{ marginBottom: 14, padding: '8px 12px', background: 'rgba(96,165,250,.07)', borderRadius: 6, fontSize: 12, color: 'var(--sv-text-dim)', lineHeight: 1.6 }}>
          💡 <strong>When to use:</strong> Run once to seed IMS with historical Shopify orders, or after a webhook outage to catch any missed events. Webhooks handle day-to-day sync automatically.
        </div>
        <button onClick={runImport} disabled={importing} style={btn(true)}>{importing ? 'Importing…' : '📦 Import Orders from Shopify'}</button>

        {importError && (
          <div style={{ marginTop: 14, padding: 12, background: 'rgba(248,113,113,.1)', borderRadius: 8, border: '1px solid rgba(248,113,113,.3)', color: 'var(--sv-red)', fontSize: 13 }}>✗ {importError}</div>
        )}
        {importResult && (
          <div style={{ marginTop: 14, padding: 14, background: 'rgba(16,185,129,.08)', borderRadius: 8, border: '1px solid rgba(16,185,129,.25)', fontSize: 13 }}>
            <strong style={{ color: '#34d399' }}>✓ Import complete</strong>
            <div style={{ marginTop: 8, color: 'var(--sv-text-main)', lineHeight: 2 }}>
              <div>Orders from Shopify: <strong>{importResult.total_from_shopify}</strong></div>
              <div>Newly imported: <strong style={{ color: '#34d399' }}>{importResult.imported}</strong></div>
              {importResult.confirmed_drafts > 0 && <div>Fixed stuck drafts (stock committed): <strong style={{ color: '#34d399' }}>{importResult.confirmed_drafts}</strong></div>}
              <div>Already existed (skipped): <strong>{importResult.skipped_existing}</strong></div>
              <div>No matched variants (skipped): <strong>{importResult.skipped_no_items}</strong></div>
              {importResult.skipped_pre_transition > 0 && <div>Before transition date (skipped): <strong>{importResult.skipped_pre_transition}</strong></div>}
              {importResult.errors?.length > 0 && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--sv-red)' }}>{importResult.errors.length} errors</summary>
                  <pre style={{ margin: '6px 0', fontSize: 11, color: 'var(--sv-text-dim)', whiteSpace: 'pre-wrap' }}>{importResult.errors.join('\n')}</pre>
                </details>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Inventory → Shopify sync */}
      <InventorySyncCard card={card} label={label} input={input} btn={btn} />

      {/* Shopify Payments payout → Xero */}
      <PayoutSyncCard card={card} label={label} input={input} btn={btn} />
    </div>
  );
}

// ─── Webhook Status Checker ───────────────────────────────────────────────────
function WebhookStatusChecker({ btn }: { btn: (p?: boolean) => React.CSSProperties }) {
  const [checking, setChecking]     = useState(false);
  const [registering, setRegistering] = useState(false);
  const [result, setResult]         = useState<any>(null);

  const check = async () => {
    setChecking(true); setResult(null);
    try {
      const r = await fetch('/api/ims/shopify/webhook-status');
      setResult(await r.json());
    } catch (e: any) { setResult({ success: false, error: e.message }); }
    setChecking(false);
  };

  const register = async () => {
    setRegistering(true); setResult(null);
    try {
      const r = await fetch('/api/ims/shopify/webhook-status', { method: 'POST' });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      // After registration, re-check so the status table refreshes
      const r2 = await fetch('/api/ims/shopify/webhook-status');
      setResult({ ...(await r2.json()), registerResults: d.results });
    } catch (e: any) { setResult({ success: false, error: e.message }); }
    setRegistering(false);
  };

  const statusIcon = (s: string) =>
    s === 'ok'        ? <span style={{ color: '#34d399', fontWeight: 700 }}>✓</span>
    : s === 'wrong_url' ? <span style={{ color: '#f59e0b', fontWeight: 700 }}>⚠</span>
    :                    <span style={{ color: '#f87171', fontWeight: 700 }}>✗</span>;

  const actionColor = (a: string) =>
    a === 'created' ? '#34d399' : a === 'updated' ? '#60a5fa' : a === 'error' ? '#f87171' : 'var(--sv-text-dim)';

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={check} disabled={checking || registering} style={btn()}>
          {checking ? 'Checking…' : '🔍 Check webhook registration'}
        </button>
        <button onClick={register} disabled={checking || registering} style={btn(true)}>
          {registering ? 'Registering…' : '⚡ Register webhooks via API'}
        </button>
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--sv-text-dim)', lineHeight: 1.5 }}>
        <strong>Tip:</strong> Use <em>Register webhooks via API</em> — it's simpler than adding them manually in Shopify, and the check will then show their status correctly. Webhooks added through the Shopify Admin UI aren't visible to the API check (a Shopify platform limitation).
      </div>

      {result && !result.success && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--sv-red)' }}>⚠ {result.error}</div>
      )}

      {result?.success && (
        <div style={{ marginTop: 12, background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 8, overflow: 'hidden', fontSize: 12 }}>
          {/* Summary */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--sv-etch)', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, color: 'var(--sv-text-strong)' }}>
              {result.allOk ? '✅ All webhooks registered' : 'Webhook status'}
            </span>
            <span style={{ color: result.hasSecret ? '#34d399' : '#f87171' }}>
              {result.hasSecret ? '✓ Signing secret saved' : '✗ Signing secret missing — paste it into Settings above'}
            </span>
            <span style={{ color: result.syncEnabled ? '#34d399' : '#fbbf24' }}>
              {result.syncEnabled ? '✓ Order sync enabled' : '⚠ Order sync disabled'}
            </span>
          </div>

          {/* Registration action results */}
          {result.registerResults && (
            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--sv-etch)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {result.registerResults.map((r: any) => (
                <span key={r.topic} style={{ fontSize: 11, color: actionColor(r.action) }}>
                  {r.action === 'created' ? '+ ' : r.action === 'updated' ? '↻ ' : r.action === 'error' ? '✗ ' : '✓ '}{r.topic}
                  {r.error ? ` (${r.error})` : ''}
                </span>
              ))}
            </div>
          )}

          {/* Per-topic rows */}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {result.topics.map((t: any) => (
                <tr key={t.topic} style={{ borderBottom: '1px solid var(--sv-etch)' }}>
                  <td style={{ padding: '7px 14px', width: 24 }}>{statusIcon(t.status)}</td>
                  <td style={{ padding: '7px 6px', fontFamily: 'monospace', color: 'var(--sv-mint)', whiteSpace: 'nowrap' }}>{t.topic}</td>
                  <td style={{ padding: '7px 6px 7px 12px', color: 'var(--sv-text-dim)' }}>
                    {t.status === 'ok'
                      ? <span style={{ color: '#34d399' }}>Registered via API ✓</span>
                      : t.status === 'wrong_url'
                      ? <span style={{ color: '#f59e0b' }}>Registered but wrong URL — click Register to fix</span>
                      : <span style={{ color: '#f87171' }}>Not registered via API — click Register, or check Shopify Admin if you added it there</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ padding: '8px 14px', borderTop: '1px solid var(--sv-etch)', color: 'var(--sv-text-dim)', fontSize: 11, lineHeight: 1.5 }}>
            Expected URL: <code style={{ fontSize: 10, background: 'var(--sv-bg-0)', padding: '1px 6px', borderRadius: 3, color: 'var(--sv-mint)' }}>{result.expectedUrl}</code>
            {result.allRegisteredViaApi === 0 && !result.registerResults && (
              <span style={{ marginLeft: 12, color: '#fbbf24' }}>⚠ No API-registered webhooks found. If you added them via the Shopify Admin UI, click <em>Register webhooks via API</em> — the UI ones won't conflict (Shopify fires both).</span>
            )}
          </div>

          {result.otherTopicsAtOurUrl?.length > 0 && (
            <div style={{ padding: '8px 14px', borderTop: '1px solid var(--sv-etch)', fontSize: 11, color: '#fbbf24' }}>
              ⚠ Other topics at this URL: {result.otherTopicsAtOurUrl.join(', ')} (not required, harmless)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Inventory Sync Card (IMS → Shopify) ──────────────────────────────────────
function InventorySyncCard({ card, label, input, btn }: { card: React.CSSProperties; label: React.CSSProperties; input: React.CSSProperties; btn: (p?: boolean) => React.CSSProperties }) {
  const [enabled, setEnabled]           = useState(false);
  const [loaded, setLoaded]             = useState(false);
  const [imsLocations, setImsLocations] = useState<{ id: number; name: string }[]>([]);
  const [pickLocationIds, setPickIds]   = useState<number[]>([]);
  const [buffer, setBuffer]             = useState<number>(0);
  const [queued, setQueued]             = useState(0);
  const [linkedCount, setLinkedCount]   = useState(0);
  const [busy, setBusy]                 = useState<string | null>(null);
  const [msg, setMsg]                   = useState<string | null>(null);
  const [preview, setPreview]           = useState<any>(null);
  const [search, setSearch]             = useState('');

  const load = () => {
    fetch('/api/ims/shopify/sync-inventory').then(r => r.json()).then(d => {
      if (d.success) {
        setEnabled(!!d.enabled);
        setImsLocations(d.imsLocations ?? []);
        setPickIds(d.pickLocationIds ?? []);
        setBuffer(d.buffer ?? 0);
        setQueued(d.queuedCount ?? 0);
        setLinkedCount(d.linkedVariants ?? 0);
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  };
  useEffect(() => { load(); }, []);

  const saveSetting = async (patch: Record<string, string>) => {
    await fetch('/api/ims/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: patch }) }).catch(() => {});
  };

  const togglePickLocation = async (id: number) => {
    const next = pickLocationIds.includes(id)
      ? pickLocationIds.filter(x => x !== id)
      : [...pickLocationIds, id];
    setPickIds(next);
    await saveSetting({ online_pick_priority: JSON.stringify(next) });
  };

  const run = async (mode: 'preview' | 'all' | 'queue') => {
    setBusy(mode); setMsg(null); if (mode !== 'preview') setPreview(null);
    try {
      const r = await fetch('/api/ims/shopify/sync-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Manual "Sync Queue Now" drains a big batch on demand (bulk GraphQL is fast).
        body: JSON.stringify(mode === 'queue' ? { mode, limit: 5000 } : { mode }),
      });
      const d = await r.json();
      if (!d.success && d.error && mode !== 'preview') throw new Error(d.error);
      if (mode === 'preview') {
        if (!d.success) throw new Error(d.error ?? 'Preview failed');
        setPreview(d); setSearch('');
      } else if (mode === 'all') {
        const q = d.queuedRemainder > 0 ? `, ${d.queuedRemainder} queued — click “Sync Queue Now” to push them immediately (or they drain every 15 min)` : '';
        setMsg(d.errors?.length
          ? `Pushed ${d.pushed}, ${d.errors.length} error(s): ${d.errors.slice(0, 2).join('; ')}${q}`
          : `✓ Pushed ${d.pushed} of ${d.totalLinked ?? d.pushed} variants${q}`);
        load();
      } else {
        if (!d.success && d.error) throw new Error(d.error);
        const pushed = d.pushed ?? 0;
        const processed = d.processed ?? 0;
        const errs = d.errors?.length ? ` — ${d.errors.slice(0, 2).join('; ')}` : '';
        setMsg(pushed === 0 && processed === 0
          ? '✓ Queue is empty — nothing to drain'
          : `✓ Drained queue: ${pushed} pushed of ${processed} processed${errs}`);
        load();
      }
    } catch (e: any) { setMsg(`⚠️ ${e.message}`); }
    setBusy(null);
  };

  const branchNames = (ids: number[]) => ids.map(id => imsLocations.find(l => l.id === id)?.name ?? `#${id}`).join(' + ');

  const previewRows = (preview?.rows ?? []).filter((r: any) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (r.sku ?? '').toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q);
  });

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: 'var(--sv-text-strong)' }}>Inventory Sync → Shopify</h3>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--sv-text-main)', lineHeight: 1.6 }}>
        Tick the IMS branches whose stock should count toward the Shopify available number. Set a safety buffer to deduct from the total. The combined result is pushed to Shopify automatically every 15 minutes.
      </p>

      {/* Enable toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div onClick={async () => { const next = !enabled; setEnabled(next); await saveSetting({ shopify_inventory_sync_enabled: next ? '1' : '0' }); }}
          style={{ width: 46, height: 25, borderRadius: 99, background: enabled ? '#10b981' : 'var(--sv-etch)', position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 3, left: enabled ? 24 : 3, width: 19, height: 19, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: enabled ? '#10b981' : 'var(--sv-text-dim)' }}>{enabled ? 'Auto-sync enabled' : 'Auto-sync disabled'}</span>
      </div>

      {/* IMS branches */}
      <div style={{ marginBottom: 18 }}>
        <label style={{ ...label, display: 'block', marginBottom: 8 }}>
          Branches to include in available stock count
        </label>
        {!loaded && <div style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>Loading branches…</div>}
        {loaded && imsLocations.length === 0 && <div style={{ fontSize: 12, color: '#fbbf24' }}>No active branches found in IMS. Add locations in the Locations view.</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {imsLocations.map(loc => {
            const checked = pickLocationIds.includes(loc.id);
            return (
              <label key={loc.id} onClick={() => togglePickLocation(loc.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: 20, border: `1px solid ${checked ? '#10b981' : 'var(--sv-etch)'}`, background: checked ? 'rgba(16,185,129,.1)' : 'var(--sv-bg-1)', cursor: 'pointer', fontSize: 13, fontWeight: checked ? 600 : 400, color: checked ? '#34d399' : 'var(--sv-text-main)', userSelect: 'none' as const }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${checked ? '#10b981' : 'var(--sv-text-dim)'}`, background: checked ? '#10b981' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {checked && <span style={{ color: '#fff', fontSize: 9, lineHeight: 1 }}>✓</span>}
                </span>
                {loc.name}
              </label>
            );
          })}
        </div>
      </div>

      {/* Buffer qty */}
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'flex-end', gap: 14 }}>
        <div>
          <label style={{ ...label, display: 'block', marginBottom: 4 }}>Safety buffer (units)</label>
          <input
            type="number" min="0" step="1" value={buffer}
            onChange={e => setBuffer(Math.max(0, parseInt(e.target.value || '0', 10)))}
            onBlur={async () => saveSetting({ shopify_inventory_buffer: String(buffer) })}
            style={{ ...input, width: 90 }}
          />
        </div>
        <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', lineHeight: 1.5, paddingBottom: 2 }}>
          Deducted from the total before pushing.<br/>Use 2–5 to guard against counting errors.
        </div>
      </div>

      {/* Formula summary */}
      {pickLocationIds.length > 0 && (
        <div style={{ marginBottom: 14, padding: '7px 12px', background: 'rgba(96,165,250,.07)', borderRadius: 6, fontSize: 12, color: 'var(--sv-text-dim)' }}>
          <strong style={{ color: 'var(--sv-text-main)' }}>Pushes: </strong>
          SUM(on_hand − committed) from{' '}
          <strong style={{ color: '#60a5fa' }}>{branchNames(pickLocationIds)}</strong>
          {buffer > 0 && <> − <strong style={{ color: '#f59e0b' }}>{buffer} buffer</strong></>}
          {' '}→ Shopify · <strong>{linkedCount}</strong> linked variants
        </div>
      )}
      {loaded && pickLocationIds.length === 0 && imsLocations.length > 0 && (
        <div style={{ marginBottom: 14, fontSize: 12, color: '#fbbf24' }}>⚠ No branches selected — tick at least one branch above.</div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => run('preview')} disabled={!!busy || pickLocationIds.length === 0} style={btn()}>{busy === 'preview' ? 'Loading…' : '🔍 Preview what will be pushed'}</button>
        <button onClick={() => run('queue')} disabled={!!busy} style={btn()}>{busy === 'queue' ? 'Syncing…' : '↻ Sync Queue Now'}</button>
        <button onClick={() => run('all')} disabled={!!busy || pickLocationIds.length === 0} style={btn(true)}>{busy === 'all' ? 'Pushing…' : '⬆ Push All to Shopify'}</button>
      </div>

      {queued > 0 && !msg && <div style={{ marginTop: 8, fontSize: 12, color: '#fbbf24' }}>{queued} variant(s) queued for next sync.</div>}
      {msg && <div style={{ marginTop: 10, fontSize: 13, color: msg.startsWith('✓') ? '#34d399' : 'var(--sv-red)' }}>{msg}</div>}

      {/* Preview modal */}
      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 12, width: 'min(720px, 100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--sv-etch)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sv-text-strong)' }}>Preview — stock that will be pushed to Shopify</div>
                <div style={{ fontSize: 12, color: 'var(--sv-text-dim)', marginTop: 4, lineHeight: 1.6 }}>
                  Counting <strong style={{ color: '#60a5fa' }}>{branchNames(preview.pickLocationIds ?? [])}</strong>
                  {(preview.buffer ?? 0) > 0 && <> − buffer <strong style={{ color: '#f59e0b' }}>{preview.buffer}</strong></>}
                  {' · '}Shopify location: <strong>{preview.shopifyLocationId ?? 'auto (resolves on first push)'}</strong>
                </div>
              </div>
              <button onClick={() => setPreview(null)} style={{ background: 'none', border: 'none', color: 'var(--sv-text-dim)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {/* Stat strip */}
            <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--sv-etch)', display: 'flex', gap: 20, fontSize: 12 }}>
              <span><strong style={{ color: 'var(--sv-text-strong)', fontSize: 15 }}>{preview.linkedVariants ?? 0}</strong> <span style={{ color: 'var(--sv-text-dim)' }}>linked variants</span></span>
              <span><strong style={{ color: '#34d399', fontSize: 15 }}>{preview.inStock ?? 0}</strong> <span style={{ color: 'var(--sv-text-dim)' }}>in stock</span></span>
              <span><strong style={{ color: '#f87171', fontSize: 15 }}>{preview.zeroStock ?? 0}</strong> <span style={{ color: 'var(--sv-text-dim)' }}>will show 0</span></span>
            </div>

            {/* Search */}
            <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--sv-etch)' }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SKU or product…" style={{ ...input, width: '100%' }} />
            </div>

            {/* Table */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--sv-bg-1)' }}>
                  <tr style={{ color: 'var(--sv-text-dim)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 20px' }}>SKU</th>
                    <th style={{ padding: '8px 6px' }}>Product</th>
                    <th style={{ padding: '8px 6px' }}>Variant</th>
                    <th style={{ padding: '8px 20px', textAlign: 'right' }}>→ Shopify</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((s: any, i: number) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--sv-etch)' }}>
                      <td style={{ padding: '6px 20px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{s.sku || '—'}</td>
                      <td style={{ padding: '6px 6px' }}>{s.name}</td>
                      <td style={{ padding: '6px 6px', color: 'var(--sv-text-dim)' }}>{s.variant_label || '—'}</td>
                      <td style={{ padding: '6px 20px', textAlign: 'right', fontWeight: 700, color: Number(s.available) > 0 ? '#34d399' : 'var(--sv-text-dim)' }}>{Number(s.available ?? 0)}</td>
                    </tr>
                  ))}
                  {previewRows.length === 0 && (
                    <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: 'var(--sv-text-dim)' }}>No matching variants.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--sv-etch)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>Showing {previewRows.length} of {(preview.rows ?? []).length}{(preview.rows ?? []).length >= 500 ? '+ (capped at 500)' : ''}</span>
              <button onClick={() => setPreview(null)} style={btn()}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Payout Sync Card (Shopify Payments → Xero) ───────────────────────────────
function PayoutSyncCard({ card, label, input, btn }: { card: React.CSSProperties; label: React.CSSProperties; input: React.CSSProperties; btn: (p?: boolean) => React.CSSProperties }) {
  const [enabled, setEnabled] = useState(false);
  const [basis, setBasis]     = useState<'cash' | 'accrual'>('cash');
  const [busy, setBusy]       = useState(false);
  const [msg, setMsg]         = useState<string | null>(null);
  const [results, setResults] = useState<any[] | null>(null);

  useEffect(() => {
    fetch('/api/ims/settings').then(r => r.ok ? r.json() : null).then(d => {
      const s = d?.data ?? d?.settings ?? d ?? {};
      setEnabled(s.shopify_payments_payout_sync_enabled === '1' || s.shopify_payments_payout_sync_enabled === 1);
      if (s.shopify_revenue_basis === 'accrual') setBasis('accrual');
    }).catch(() => {});
  }, []);

  const save = async (patch: Record<string, string>) => {
    await fetch('/api/ims/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: patch }) }).catch(() => {});
  };

  const runNow = async () => {
    setBusy(true); setMsg(null); setResults(null);
    try {
      const r = await fetch('/api/ims/shopify/payout-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lookbackDays: 14 }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Sync failed');
      setResults(d.results ?? []);
      setMsg(`✓ Posted ${d.posted} payout(s) to Xero`);
    } catch (e: any) { setMsg(`⚠️ ${e.message}`); }
    setBusy(false);
  };

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: 'var(--sv-text-strong)' }}>Shopify Payments → Xero (payouts)</h3>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--sv-text-main)', lineHeight: 1.6 }}>
        Posts each confirmed Shopify Payments payout to Xero as one invoice whose total equals the bank deposit — net of processing fees and refunds — with a payment into your Shopify clearing account. Runs automatically each morning (~11am) after Shopify releases the payout. Other gateways (PayPal etc.) keep using the nightly sales batch.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div onClick={async () => { const next = !enabled; setEnabled(next); await save({ shopify_payments_payout_sync_enabled: next ? '1' : '0' }); }}
          style={{ width: 46, height: 25, borderRadius: 99, background: enabled ? '#10b981' : 'var(--sv-etch)', position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 3, left: enabled ? 24 : 3, width: 19, height: 19, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: enabled ? '#10b981' : 'var(--sv-text-dim)' }}>{enabled ? 'Payout sync enabled' : 'Payout sync disabled'}</span>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={label}>Revenue recognition</label>
        <select value={basis} onChange={async e => { const v = e.target.value as 'cash' | 'accrual'; setBasis(v); await save({ shopify_revenue_basis: v }); }} style={input}>
          <option value="cash">Cash basis — recognise revenue on the payout date (recommended)</option>
          <option value="accrual">Accrual — recognise on order date (uses the nightly sales batch)</option>
        </select>
        <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginTop: 4 }}>
          Requires Xero account roles <strong>Sales Revenue</strong>, <strong>Merchant / Payment Fees</strong> and <strong>Shopify Payments Clearing</strong> (a bank account) to be mapped in the Xero integration settings.
        </div>
      </div>

      <button onClick={runNow} disabled={busy || !enabled} style={btn(true)}>{busy ? 'Syncing…' : '⬆ Sync Payouts Now'}</button>
      {basis === 'accrual' && <div style={{ marginTop: 10, fontSize: 12, color: '#fbbf24' }}>Accrual mode posts via the nightly sales batch — the payout-based posting only runs on cash basis.</div>}

      {msg && <div style={{ marginTop: 12, fontSize: 13, color: msg.startsWith('✓') ? '#34d399' : 'var(--sv-red)' }}>{msg}</div>}

      {results && results.length > 0 && (
        <div style={{ marginTop: 12, padding: 12, background: 'var(--sv-bg-1)', borderRadius: 8, border: '1px solid var(--sv-etch)', fontSize: 12 }}>
          {results.map((r: any, i: number) => (
            <div key={i} style={{ padding: '3px 0', color: r.posted ? '#34d399' : r.error ? 'var(--sv-red)' : 'var(--sv-text-dim)' }}>
              Payout {r.payoutId} ({r.date}): {r.posted ? 'posted ✓' : r.skipped ? r.skipped : r.error ? `error — ${r.error}` : 'not posted'}
            </div>
          ))}
        </div>
      )}
      {results && results.length === 0 && <div style={{ marginTop: 12, fontSize: 12, color: 'var(--sv-text-dim)' }}>No new confirmed payouts to post.</div>}
    </div>
  );
}
