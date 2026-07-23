import React, { useCallback, useEffect, useState } from 'react';

interface BrandsViewProps {
  apiFetch: (url: string, opts?: RequestInit) => Promise<any>;
  inputStyle: React.CSSProperties;
  btnStyle: (variant: any, size?: any) => React.CSSProperties;
  Spinner: React.ComponentType<any>;
  EmptyState: React.ComponentType<{ text: string }>;
}

export function BrandsView({ apiFetch, inputStyle, btnStyle, Spinner, EmptyState }: BrandsViewProps) {
  const [brands, setBrands] = useState<{ id: number; name: string; website_url: string | null; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/ims/brands').then(r => r.json()).then(d => {
      if (d.success) setBrands(d.data);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await apiFetch('/api/ims/brands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName.trim() }) });
      setNewName('');
      load();
    } catch (e: any) { alert(e.message); }
    finally { setAdding(false); }
  };

  const handleSaveEdit = async (id: number) => {
    if (!editName.trim()) return;
    try {
      await apiFetch(`/api/ims/brands/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editName.trim(), website_url: editUrl.trim() || null }) });
      setEditId(null);
      load();
    } catch (e: any) { alert(e.message); }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete brand "${name}"? This does not affect existing products.`)) return;
    try {
      await apiFetch(`/api/ims/brands/${id}`, { method: 'DELETE' });
      load();
    } catch (e: any) { alert(e.message); }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sv-text-strong)', margin: 0, flex: 1 }}>Brands</h1>
      </div>

      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 20, maxWidth: 420 }}>
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New brand name…" style={{ ...inputStyle, flex: 1 }} />
        <button type="submit" disabled={adding || !newName.trim()} style={btnStyle('action')}>Add</button>
      </form>

      {loading ? <Spinner /> : brands.length === 0 ? <EmptyState text="No brands yet. Add one above." /> : (
        <div style={{ background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10, overflow: 'hidden', maxWidth: 720 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--sv-etch)' }}>
                {['Brand Name', 'Website URL', 'Added', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: 'var(--sv-text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .8 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {brands.map(b => (
                <tr key={b.id} style={{ borderTop: '1px solid var(--sv-etch)' }}>
                  {editId === b.id ? (
                    <>
                      <td style={{ padding: '8px 14px' }}>
                        <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(b.id); if (e.key === 'Escape') setEditId(null); }}
                          style={{ ...inputStyle, fontSize: 13, width: 180 }} placeholder="Brand name" />
                      </td>
                      <td style={{ padding: '8px 14px' }}>
                        <input type="url" value={editUrl} onChange={e => setEditUrl(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(b.id); if (e.key === 'Escape') setEditId(null); }}
                          style={{ ...inputStyle, fontSize: 13, width: 220 }} placeholder="https://brand.com" />
                      </td>
                      <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--sv-text-dim)' }}>
                        {new Date(b.created_at).toLocaleDateString('en-AU')}
                      </td>
                      <td style={{ padding: '8px 14px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => handleSaveEdit(b.id)} style={btnStyle('action', 'xs')}>Save</button>
                          <button onClick={() => setEditId(null)} style={btnStyle('ghost', 'xs')}>×</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '8px 14px' }}>
                        <span style={{ fontWeight: 500 }}>{b.name}</span>
                      </td>
                      <td style={{ padding: '8px 14px', fontSize: 12 }}>
                        {b.website_url
                          ? <a href={b.website_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--sv-action)', textDecoration: 'none' }}>{b.website_url}</a>
                          : <span style={{ color: 'var(--sv-text-dim)' }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--sv-text-dim)' }}>
                        {new Date(b.created_at).toLocaleDateString('en-AU')}
                      </td>
                      <td style={{ padding: '8px 14px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => { setEditId(b.id); setEditName(b.name); setEditUrl(b.website_url ?? ''); }} style={btnStyle('ghost', 'xs')}>Edit</button>
                          <button onClick={() => handleDelete(b.id, b.name)} style={btnStyle('danger', 'xs')}>Del</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
