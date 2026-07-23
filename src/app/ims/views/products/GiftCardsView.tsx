import React, { useCallback, useEffect, useState } from 'react';

interface GiftCard {
  id: number;
  code: string;
  initial_balance: number | null;
  balance: number;
  currency: string;
  status: 'active' | 'redeemed' | 'cancelled' | 'expired';
  expires_on: string | null;
  shopify_gc_id: number | null;
  customer_id: string | null;
  order_id: string | null;
  recipient_email: string | null;
  notes: string | null;
  created_at: string;
  last_used_at: string | null;
}

const GC_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  active:    { bg: '#dcfce7', color: '#166534' },
  redeemed:  { bg: '#f3f4f6', color: '#6b7280' },
  cancelled: { bg: '#fee2e2', color: '#991b1b' },
  expired:   { bg: '#fef3c7', color: '#92400e' },
};

const EMPTY_GC: Omit<GiftCard, 'id' | 'created_at' | 'updated_at' | 'shopify_gc_id'> = {
  code: '', initial_balance: null, balance: 0, currency: 'AUD', status: 'active',
  expires_on: null, customer_id: null, order_id: null,
  recipient_email: null, notes: null, last_used_at: null,
};

interface GiftCardsViewProps {
  inputStyle: React.CSSProperties;
  btnStyle: (variant: any, size?: any) => React.CSSProperties;
  Spinner: React.ComponentType<any>;
  EmptyState: React.ComponentType<{ text: string }>;
  fmtCurrency: (n: number | null | undefined) => string;
}

export function GiftCardsView({ inputStyle, btnStyle, Spinner, EmptyState, fmtCurrency }: GiftCardsViewProps) {
  const [cards, setCards]       = useState<GiftCard[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [page, setPage]         = useState(1);
  const PAGE_SIZE = 100;
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch]     = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [modalOpen, setModalOpen]   = useState(false);
  const [editing, setEditing]       = useState<GiftCard | null>(null);
  const [form, setForm]             = useState<typeof EMPTY_GC>({ ...EMPTY_GC });
  const [saving, setSaving]         = useState(false);
  const [gcHistory, setGcHistory]         = useState<any[]>([]);
  const [gcHistoryLoading, setGcHistoryLoading] = useState(false);
  const [gcMode, setGcMode]         = useState<'off' | 'combined'>('off');
  const [shopDomain, setShopDomain] = useState('');

  useEffect(() => {
    fetch('/api/ims/settings').then(r => r.json()).then(d => {
      if (d.data?.shopify_gc_mode) setGcMode(d.data.shopify_gc_mode as 'off' | 'combined');
      if (d.shopDomain) setShopDomain(d.shopDomain);
    }).catch(() => {});
  }, []);

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting]   = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number; errors: string[] } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String((page - 1) * PAGE_SIZE));
    fetch(`/api/ims/gift-cards?${params}`)
      .then(r => r.json())
      .then(d => { if (d.success) { setCards(d.data); setTotal(d.total); } })
      .finally(() => setLoading(false));
  }, [statusFilter, debouncedSearch, page]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_GC });
    setModalOpen(true);
  };

  const openEdit = (card: GiftCard) => {
    setEditing(card);
    setForm({
      code: card.code,
      initial_balance: card.initial_balance,
      balance: card.balance,
      currency: card.currency ?? 'AUD',
      status: card.status,
      expires_on: card.expires_on ? card.expires_on.slice(0, 10) : null,
      customer_id: card.customer_id,
      order_id: card.order_id,
      recipient_email: card.recipient_email,
      notes: card.notes,
      last_used_at: card.last_used_at,
    });
    setGcHistory([]);
    setGcHistoryLoading(true);
    fetch(`/api/ims/gift-cards/${card.id}/transactions`)
      .then(r => r.json())
      .then(d => { if (d.success) setGcHistory(d.data ?? []); })
      .catch(() => {})
      .finally(() => setGcHistoryLoading(false));
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.code.trim()) { alert('Code is required'); return; }
    setSaving(true);
    try {
      if (editing) {
        const r = await fetch(`/api/ims/gift-cards/${editing.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error ?? 'Failed');
      } else {
        const r = await fetch('/api/ims/gift-cards', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
        });
        const d = await r.json();
        if (!d.success && d.error) throw new Error(d.error);
      }
      setModalOpen(false);
      load();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (card: GiftCard) => {
    if (!confirm(`Delete gift card "${card.code}"? This cannot be undone.`)) return;
    try {
      const r = await fetch(`/api/ims/gift-cards/${card.id}`, { method: 'DELETE' });
      const d = await r.json();
      if (!d.success) throw new Error(d.error ?? 'Delete failed');
      load();
    } catch (e: any) { alert(e.message); }
  };

  const parseSageDate = (str: string): string | null => {
    if (!str || !str.trim()) return null;
    const [datePart, timePart = '0:00'] = str.trim().split(' ');
    const [day, month, year] = datePart.split('/');
    const [hours, minutes]   = (timePart || '0:00').split(':');
    if (!day || !month || !year) return null;
    return `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')} ${hours.padStart(2,'0')}:${(minutes ?? '00').padStart(2,'0')}:00`;
  };

  const parseCsvText = (text: string) => {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const headers = lines[0].split(',').map((h: string) => h.trim().replace(/^"|"$/g, ''));
    const rows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const values: string[] = [];
      let cur = '', inQuote = false;
      for (const ch of line) {
        if (ch === '"') { inQuote = !inQuote; }
        else if (ch === ',' && !inQuote) { values.push(cur); cur = ''; }
        else cur += ch;
      }
      values.push(cur);
      const obj: any = {};
      headers.forEach((h: string, idx: number) => { obj[h] = (values[idx] ?? '').trim(); });
      rows.push(obj);
    }
    return rows;
  };

  const handleImport = async () => {
    if (!importFile) { alert('Choose a CSV file first.'); return; }
    setImporting(true);
    setImportResult(null);
    try {
      const text = await importFile.text();
      const rawRows = parseCsvText(text);
      const rows = rawRows
        .filter((r: any) => r['Code']?.trim())
        .map((r: any) => ({
          code:               r['Code'].trim().toUpperCase(),
          balance:            parseFloat(r['Balance'] ?? '0') || 0,
          status:             (['active','redeemed','cancelled','expired'].includes((r['Status'] ?? '').toLowerCase())
                                ? r['Status'].toLowerCase() : 'active'),
          customer_id:        r['Customer ID']?.trim() || null,
          order_id:           'imported',
          shopify_location_id: r['Location ID']?.trim() || null,
          recipient_email:    r['Last recipient email']?.trim() || null,
          created_at:         parseSageDate(r['Created at']),
          last_used_at:       parseSageDate(r['Last used']),
          initial_balance:    null,
        }));

      const res = await fetch('/api/ims/gift-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bulk: true, rows }),
      });
      const d = await res.json();
      if (d.success) {
        setImportResult({ inserted: d.inserted, skipped: d.skipped, errors: d.errors ?? [] });
        load();
      } else {
        alert(d.error ?? 'Import failed');
      }
    } catch (e: any) { alert(e.message); }
    finally { setImporting(false); }
  };

  const fmtDate = (dt: string | null) =>
    dt ? new Date(dt).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const statusBadge = (status: string) => {
    const c = GC_STATUS_COLORS[status] ?? { bg: '#f3f4f6', color: '#374151' };
    return (
      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: c.bg, color: c.color, textTransform: 'capitalize' }}>
        {status}
      </span>
    );
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Gift Cards</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setImportOpen(v => !v)} style={btnStyle('ghost', 'sm')}>Import CSV</button>
          <button onClick={openCreate} style={btnStyle('action', 'sm')}>+ New Gift Card</button>
        </div>
      </div>

      {importOpen && (
        <div style={{ background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Import from CSV (Sage / Shopify export format)</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input type="file" accept=".csv" onChange={e => { setImportFile(e.target.files?.[0] ?? null); setImportResult(null); }}
              style={{ fontSize: 13 }} />
            <button onClick={handleImport} disabled={importing || !importFile} style={btnStyle('action', 'sm')}>
              {importing ? 'Importing…' : 'Import'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--sv-text-dim)', marginTop: 8 }}>
            Columns expected: Code, Created at, Last used, Balance, Status, Customer ID, Order ID, Location ID, Last recipient email<br />
            Order IDs from the file are ignored — imported cards are tagged as <strong>imported</strong>.
          </div>
          {importResult && (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              <strong style={{ color: '#166534' }}>✓ Inserted: {importResult.inserted}</strong>
              {importResult.skipped > 0 && <span style={{ marginLeft: 12, color: 'var(--sv-text-dim)' }}>Skipped (duplicates): {importResult.skipped}</span>}
              {importResult.errors.length > 0 && (
                <div style={{ color: '#991b1b', marginTop: 6 }}>
                  {importResult.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
                  {importResult.errors.length > 5 && <div>…and {importResult.errors.length - 5} more errors</div>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Search code, email, customer…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ ...inputStyle, width: 260 }}
        />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, width: 150 }}>
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="redeemed">Redeemed</option>
          <option value="cancelled">Cancelled</option>
          <option value="expired">Expired</option>
        </select>
        {total > 0 && <span style={{ fontSize: 13, color: 'var(--sv-text-dim)' }}>{total} card{total !== 1 ? 's' : ''}</span>}
      </div>

      {loading ? <Spinner /> : cards.length === 0 ? (
        <EmptyState text="No gift cards found." />
      ) : (
        <>
        <div style={{ background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--sv-etch)' }}>
                {['Code', 'Balance', 'Status', 'Expires', 'Email', 'Created', 'Last Used', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: 'var(--sv-text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .8, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cards.map(card => (
                <tr key={card.id} style={{ borderTop: '1px solid var(--sv-etch)' }}>
                  <td style={{ padding: '8px 14px', fontWeight: 600, fontSize: 13, fontFamily: 'monospace', letterSpacing: .5 }}>{card.code}</td>
                  <td style={{ padding: '8px 14px', fontSize: 13 }}>{fmtCurrency(card.balance)}</td>
                  <td style={{ padding: '8px 14px' }}>{statusBadge(card.status)}</td>
                  <td style={{ padding: '8px 14px', fontSize: 12, color: card.expires_on ? 'var(--sv-text-main)' : 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>
                    {card.expires_on ? fmtDate(card.expires_on) : '—'}
                  </td>
                  <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--sv-text-dim)' }}>{card.recipient_email ?? '—'}</td>
                  <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>{fmtDate(card.created_at)}</td>
                  <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>{fmtDate(card.last_used_at)}</td>
                  <td style={{ padding: '8px 14px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => openEdit(card)} style={btnStyle('ghost', 'xs')}>Edit</button>
                      <button onClick={() => handleDelete(card)} style={btnStyle('danger', 'xs')}>Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {Math.ceil(total / PAGE_SIZE) > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14 }}>
            <button onClick={() => setPage(1)} disabled={page === 1} style={btnStyle('secondary', 'sm')}>«</button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={btnStyle('secondary', 'sm')}>‹ Prev</button>
            <span style={{ fontSize: 13, color: 'var(--sv-text-dim)', padding: '0 8px' }}>
              Page {page} of {Math.ceil(total / PAGE_SIZE)} ({total} card{total !== 1 ? 's' : ''})
            </span>
            <button onClick={() => setPage(p => Math.min(Math.ceil(total / PAGE_SIZE), p + 1))} disabled={page === Math.ceil(total / PAGE_SIZE)} style={btnStyle('secondary', 'sm')}>Next ›</button>
            <button onClick={() => setPage(Math.ceil(total / PAGE_SIZE))} disabled={page === Math.ceil(total / PAGE_SIZE)} style={btnStyle('secondary', 'sm')}>»</button>
          </div>
        )}
        </>
      )}

      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setModalOpen(false); }}>
          <div style={{ background: 'var(--sv-bg-0)', borderRadius: 12, width: 520, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', padding: 28, boxShadow: '0 8px 48px rgba(0,0,0,.28)' }}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>{editing ? 'Edit Gift Card' : 'New Gift Card'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={{ fontSize: 13 }}>
                Code <span style={{ color: '#dc2626' }}>*</span>
                <input
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  style={{ ...inputStyle, display: 'block', width: '100%', marginTop: 4, fontFamily: 'monospace', letterSpacing: .5 }}
                  placeholder="e.g. GC10001"
                />
              </label>
              <div style={{ display: 'flex', gap: 12 }}>
                <label style={{ fontSize: 13, flex: 1 }}>
                  Balance <span style={{ color: '#dc2626' }}>*</span>
                  <input
                    type="number" step="0.01" min="0"
                    value={form.balance}
                    onChange={e => setForm(f => ({ ...f, balance: parseFloat(e.target.value) || 0 }))}
                    style={{ ...inputStyle, display: 'block', width: '100%', marginTop: 4 }}
                  />
                </label>
                <label style={{ fontSize: 13, flex: 1 }}>
                  Status
                  <select
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))}
                    style={{ ...inputStyle, display: 'block', width: '100%', marginTop: 4 }}
                  >
                    <option value="active">Active</option>
                    <option value="redeemed">Redeemed</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="expired">Expired</option>
                  </select>
                </label>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <label style={{ fontSize: 13, flex: 1 }}>
                  Expires On
                  <input
                    type="date"
                    value={form.expires_on ?? ''}
                    onChange={e => setForm(f => ({ ...f, expires_on: e.target.value || null }))}
                    style={{ ...inputStyle, display: 'block', width: '100%', marginTop: 4 }}
                  />
                </label>
                <label style={{ fontSize: 13, flex: 1 }}>
                  Currency
                  <input
                    value={form.currency}
                    onChange={e => setForm(f => ({ ...f, currency: e.target.value.toUpperCase() }))}
                    style={{ ...inputStyle, display: 'block', width: '100%', marginTop: 4 }}
                    maxLength={10}
                  />
                </label>
              </div>
              <label style={{ fontSize: 13 }}>
                Customer ID
                <input
                  value={form.customer_id ?? ''}
                  onChange={e => setForm(f => ({ ...f, customer_id: e.target.value || null }))}
                  style={{ ...inputStyle, display: 'block', width: '100%', marginTop: 4 }}
                  placeholder="Shopify customer UUID (optional)"
                />
              </label>
              <label style={{ fontSize: 13 }}>
                Recipient Email
                <input
                  type="email"
                  value={form.recipient_email ?? ''}
                  onChange={e => setForm(f => ({ ...f, recipient_email: e.target.value || null }))}
                  style={{ ...inputStyle, display: 'block', width: '100%', marginTop: 4 }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                Notes
                <textarea
                  value={form.notes ?? ''}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value || null }))}
                  rows={3}
                  style={{ ...inputStyle, display: 'block', width: '100%', marginTop: 4, resize: 'vertical' }}
                />
              </label>

              {editing && editing.shopify_gc_id && gcMode === 'combined' && shopDomain && (
                <div style={{ paddingTop: 16, borderTop: '1px solid var(--sv-etch)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, opacity: 0.6 }}>
                    <path d="M10.5 3H17v6.5M17 3l-9 9M8 5H4a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <a
                    href={`https://${shopDomain}/admin/gift_cards/${editing.shopify_gc_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12, color: 'var(--sv-action)', textDecoration: 'none' }}
                  >
                    View in Shopify Admin
                  </a>
                </div>
              )}

              {editing && (
                <div style={{ borderTop: '1px solid var(--sv-etch)', paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--sv-text-strong)' }}>Balance History</div>
                  {gcHistoryLoading ? (
                    <div style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>Loading…</div>
                  ) : gcHistory.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--sv-text-dim)', fontStyle: 'italic' }}>No transactions recorded.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                      {gcHistory.map((t, i) => {
                        const amt = Number(t.amount);
                        const bal = Number(t.balance_after);
                        const isPos = amt >= 0;
                        const icons: Record<string, string> = { issue: '🎁', redeem: '💳', return: '↩', adjust: '✏️' };
                        const icon = icons[t.type] ?? '•';
                        const dt = new Date(t.created_at).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
                        return (
                          <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderTop: i > 0 ? '1px solid var(--sv-etch)' : undefined }}>
                            <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'capitalize' as const, color: 'var(--sv-text-main)' }}>{t.type}</span>
                                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: isPos ? '#34d399' : '#f87171', flexShrink: 0 }}>
                                  {isPos ? '+' : ''}{amt.toFixed(2)}
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 1 }}>
                                <span style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>
                                  {t.notes ?? (t.pos_sale_id ? `Sale #${t.pos_sale_id}` : '')}
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--sv-text-dim)', flexShrink: 0 }}>bal: ${bal.toFixed(2)}</span>
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--sv-text-dim)', marginTop: 1 }}>{dt}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
              <button onClick={() => setModalOpen(false)} style={btnStyle('ghost', 'sm')}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={btnStyle('action', 'sm')}>
                {saving ? 'Saving…' : (editing ? 'Save Changes' : 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
