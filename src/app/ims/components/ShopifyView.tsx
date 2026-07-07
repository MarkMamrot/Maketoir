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
        <div style={{ padding: 24, background: 'var(--sv-bg-2)', borderRadius: 10, border: '1px solid var(--sv-etch)', maxWidth: 520 }}>
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
    <div style={{ maxWidth: 860 }}>
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
    <div style={{ maxWidth: 680 }}>
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
          Add this URL in <strong>Shopify Admin → Settings → Notifications → Webhooks</strong> for the following events: <code>orders/create</code>, <code>orders/cancelled</code>, <code>fulfillments/create</code>
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <code style={{ flex: 1, padding: '8px 12px', background: 'var(--sv-bg-1)', borderRadius: 6, border: '1px solid var(--sv-etch)', fontSize: 12, color: 'var(--sv-mint)', overflowX: 'auto' as const }}>{webhookUrl}</code>
          <button onClick={() => navigator.clipboard?.writeText(webhookUrl)} style={btn()}>Copy</button>
        </div>
      </div>

      {/* Manual import */}
      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: 'var(--sv-text-strong)' }}>Manual Order Import</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--sv-text-main)', lineHeight: 1.6 }}>
          Pulls all Shopify orders from the transition date to now and imports them into IMS. Safe to run multiple times — existing orders are skipped.
        </p>
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
    </div>
  );
}
