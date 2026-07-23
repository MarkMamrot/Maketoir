import React, { useEffect, useRef, useState } from 'react';
import type { FilterSelection, MultiFilter, SBDateRange } from './reportFilterUtils';

export type { FilterSelection, MultiFilter, SBDateRange } from './reportFilterUtils';
export { EMPTY_MULTI, hasMultiFilter, multiFilterParams, WINDOW_OPTS } from './reportFilterUtils';

interface FilterSuggestion {
  type: 'product' | 'brand' | 'supplier' | 'product_type' | 'category' | 'subcategory';
  value: string;
  label: string;
  meta?: string;
}

const TYPE_PILL_COLORS: Record<FilterSelection['type'], { bg: string; text: string }> = {
  product:      { bg: 'rgba(99,102,241,.15)',  text: 'var(--sv-action)' },
  brand:        { bg: 'rgba(16,185,129,.15)',  text: 'var(--sv-mint)' },
  supplier:     { bg: 'rgba(245,158,11,.15)',  text: '#d97706' },
  product_type: { bg: 'rgba(139,92,246,.15)',  text: '#7c3aed' },
  category:     { bg: 'rgba(20,184,166,.15)',  text: '#0d9488' },
  subcategory:  { bg: 'rgba(20,184,166,.10)',  text: '#0f766e' },
};

export function ReportFilterCombobox({
  selection,
  onSelect,
  onClear,
  placeholder = 'Filter by product, brand, supplier or type…',
}: {
  selection: FilterSelection | null;
  onSelect: (s: FilterSelection) => void;
  onClear: () => void;
  placeholder?: string;
}) {
  const [query, setQuery]               = useState('');
  const [suggestions, setSuggestions]   = useState<FilterSuggestion[]>([]);
  const [open, setOpen]                 = useState(false);
  const [loading, setLoading]           = useState(false);
  const [activeIdx, setActiveIdx]       = useState(-1);
  const debounceRef                     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef                    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setSuggestions([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/ims/filters/search?q=${encodeURIComponent(query)}&limit=25`);
        const d = await res.json();
        setSuggestions(d.suggestions ?? []);
        setOpen(true);
        setActiveIdx(-1);
      } catch { /* ignore */ } finally { setLoading(false); }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const choose = (s: FilterSuggestion) => {
    onSelect({ type: s.type, value: s.value, label: s.label, meta: s.meta });
    setQuery('');
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); choose(suggestions[activeIdx]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1, minWidth: 260, maxWidth: 500 }}>
      {selection ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          height: 36, padding: '0 10px 0 12px',
          border: '1px solid var(--sv-action)', borderRadius: 8,
          background: 'var(--sv-bg-0)', cursor: 'default',
        }}>
          <span style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
            padding: '2px 7px', borderRadius: 4,
            background: TYPE_PILL_COLORS[selection.type].bg,
            color: TYPE_PILL_COLORS[selection.type].text,
            flexShrink: 0,
          }}>
            {selection.type === 'product_type' ? 'Type' : selection.type}
          </span>
          <span style={{ fontSize: 13, color: 'var(--sv-text-strong)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selection.label.replace(/^(Product:|Brand:|Supplier:|Product Type:)\s*/i, '')}
          </span>
          <button
            onClick={onClear}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sv-text-dim)', fontSize: 16, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
            title="Clear filter"
          >×</button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
            placeholder={placeholder}
            style={{
              width: '100%', height: 36, padding: '0 36px 0 12px',
              borderRadius: 8, border: '1px solid var(--sv-etch)',
              background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)',
              fontSize: 13, boxSizing: 'border-box',
            }}
          />
          {loading && (
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--sv-text-dim)' }}>…</span>
          )}
          {!loading && query && (
            <button
              onClick={() => { setQuery(''); setSuggestions([]); setOpen(false); }}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sv-text-dim)', fontSize: 16, lineHeight: 1, padding: 0 }}
            >×</button>
          )}
        </div>
      )}

      {open && suggestions.length > 0 && !selection && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.18)',
          zIndex: 9999, overflow: 'hidden', maxHeight: 360, overflowY: 'auto',
        }}>
          {suggestions.map((s, i) => {
            const colors = TYPE_PILL_COLORS[s.type];
            return (
              <div
                key={`${s.type}:${s.value}`}
                onMouseDown={() => choose(s)}
                style={{
                  padding: '9px 12px', cursor: 'pointer',
                  background: i === activeIdx ? 'color-mix(in srgb, var(--sv-etch) 40%, transparent)' : 'transparent',
                  borderBottom: '1px solid var(--sv-etch)',
                  display: 'flex', alignItems: 'flex-start', gap: 9,
                }}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <span style={{
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                  padding: '2px 6px', borderRadius: 4, marginTop: 2,
                  background: colors.bg, color: colors.text, flexShrink: 0, whiteSpace: 'nowrap',
                }}>
                  {s.type === 'product_type' ? 'Type' : s.type}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--sv-text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.label}
                  </div>
                  {s.meta && (
                    <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginTop: 2 }}>{s.meta}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {open && query.length > 1 && suggestions.length === 0 && !loading && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.18)', zIndex: 9999,
          padding: '12px 16px', fontSize: 13, color: 'var(--sv-text-dim)', textAlign: 'center',
        }}>
          No matches found
        </div>
      )}
    </div>
  );
}

function SearchableTypeFilter({
  filterType,
  placeholder,
  selection,
  onSelect,
  onClear,
}: {
  filterType: 'product' | 'supplier' | 'brand' | 'product_type' | 'category' | 'subcategory';
  placeholder: string;
  selection: FilterSelection | null;
  onSelect: (s: FilterSelection) => void;
  onClear: () => void;
}) {
  const [query, setQuery]             = useState('');
  const [options, setOptions]         = useState<FilterSuggestion[]>([]);
  const [open, setOpen]               = useState(false);
  const [loading, setLoading]         = useState(false);
  const [activeIdx, setActiveIdx]     = useState(-1);
  const debounceRef                   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef                  = useRef<HTMLDivElement>(null);
  const colors                        = TYPE_PILL_COLORS[filterType];

  const fetchOptions = async (q: string) => {
    if (filterType === 'product' && !q) { setOptions([]); return; }
    setLoading(true);
    try {
      const url = `/api/ims/filters/search?only=${filterType}&limit=40${q ? `&q=${encodeURIComponent(q)}` : ''}`;
      const res = await fetch(url);
      const d = await res.json();
      setOptions(d.suggestions ?? []);
      setOpen(true);
      setActiveIdx(-1);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => { if (filterType !== 'product') fetchOptions(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchOptions(query), 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: MouseEvent) => { if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const choose = (s: FilterSuggestion) => {
    onSelect({ type: s.type, value: s.value, label: s.label, meta: s.meta });
    setQuery('');
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || options.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); choose(options[activeIdx]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  const typeLabel = filterType === 'product_type' ? 'Type' : filterType === 'product' ? 'Product' : filterType === 'subcategory' ? 'Subcategory' : filterType.charAt(0).toUpperCase() + filterType.slice(1);

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: filterType === 'product' ? 1.6 : 1, minWidth: filterType === 'product' ? 200 : 140 }}>
      {selection ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 8px 0 10px', border: `1px solid ${colors.text}66`, borderRadius: 7, background: colors.bg, cursor: 'default' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: colors.text, flexShrink: 0 }}>{typeLabel}</span>
          <span style={{ fontSize: 12, color: 'var(--sv-text-strong)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selection.label.replace(/^(Product:|Brand:|Supplier:|Type:|Product Type:)\s*/i, '')}
          </span>
          <button onClick={onClear} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.text, fontSize: 15, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>×</button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, fontWeight: 700, color: colors.text, pointerEvents: 'none', whiteSpace: 'nowrap' }}>{typeLabel}</div>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (options.length > 0) setOpen(true); }}
            placeholder={placeholder}
            style={{ width: '100%', height: 34, padding: `0 28px 0 ${typeLabel.length * 7 + 16}px`, borderRadius: 7, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', fontSize: 12, boxSizing: 'border-box' }}
          />
          {loading ? (
            <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--sv-text-dim)' }}>…</span>
          ) : query ? (
            <button onClick={() => { setQuery(''); }} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sv-text-dim)', fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
          ) : (
            <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--sv-text-dim)', pointerEvents: 'none' }}>▾</span>
          )}
        </div>
      )}
      {open && !selection && options.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0, background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 7, boxShadow: '0 6px 18px rgba(0,0,0,.18)', zIndex: 9999, maxHeight: 260, overflowY: 'auto' }}>
          {options.map((s, i) => (
            <div key={s.value} onMouseDown={() => choose(s)} onMouseEnter={() => setActiveIdx(i)}
              style={{ padding: '8px 10px', cursor: 'pointer', background: i === activeIdx ? 'color-mix(in srgb, var(--sv-etch) 40%, transparent)' : 'transparent', borderBottom: '1px solid var(--sv-etch)', fontSize: 12, color: 'var(--sv-text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {s.label.replace(/^(Product:|Brand:|Supplier:|Type:|Product Type:)\s*/i, '')}
            </div>
          ))}
        </div>
      )}
      {open && !selection && options.length === 0 && !loading && query.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0, background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 7, boxShadow: '0 6px 18px rgba(0,0,0,.18)', zIndex: 9999, padding: '10px', fontSize: 12, color: 'var(--sv-text-dim)', textAlign: 'center' }}>No matches</div>
      )}
    </div>
  );
}

export function ReportMultiFilter({
  filters, onChange, showCategories = false,
}: { filters: MultiFilter; onChange: (f: MultiFilter) => void; showCategories?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}>
      <SearchableTypeFilter filterType="product"  placeholder="Product name / SKU…" selection={filters.product}
        onSelect={s => onChange({ ...filters, product: s })}  onClear={() => onChange({ ...filters, product: null })} />
      <SearchableTypeFilter filterType="supplier" placeholder="All Suppliers" selection={filters.supplier}
        onSelect={s => onChange({ ...filters, supplier: s })} onClear={() => onChange({ ...filters, supplier: null })} />
      <SearchableTypeFilter filterType="brand"    placeholder="All Brands"    selection={filters.brand}
        onSelect={s => onChange({ ...filters, brand: s })}    onClear={() => onChange({ ...filters, brand: null })} />
      <SearchableTypeFilter filterType="product_type" placeholder="All Types" selection={filters.type_}
        onSelect={s => onChange({ ...filters, type_: s })}    onClear={() => onChange({ ...filters, type_: null })} />
      {showCategories && (
        <SearchableTypeFilter filterType="category" placeholder="All Categories" selection={filters.category}
          onSelect={s => onChange({ ...filters, category: s })} onClear={() => onChange({ ...filters, category: null })} />
      )}
      {showCategories && (
        <SearchableTypeFilter filterType="subcategory" placeholder="All Subcategories" selection={filters.subcategory}
          onSelect={s => onChange({ ...filters, subcategory: s })} onClear={() => onChange({ ...filters, subcategory: null })} />
      )}
    </div>
  );
}

const todaySB = () => new Date().toLocaleDateString('sv-SE');
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('sv-SE'); };

export function SBDatePicker({ value, onChange }: { value: SBDateRange; onChange: (r: SBDateRange) => void }) {
  const [open, setOpen] = React.useState(false);
  const [tab,  setTab]  = React.useState<'presets' | 'custom'>('presets');
  const [cfrom, setCfrom] = React.useState('');
  const [cto,   setCto]   = React.useState('');
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const presets: { label: string; make: () => SBDateRange }[] = [
    { label: 'Today',         make: () => ({ kind: 'range' as const, from: todaySB(), to: todaySB(), label: 'Today' }) },
    { label: 'Yesterday',     make: () => { const y = daysAgo(1); return { kind: 'range' as const, from: y, to: y, label: 'Yesterday' }; } },
    { label: 'Last 7 days',   make: () => ({ kind: 'window' as const, window: 7,   label: '7 Days' }) },
    { label: 'Last 30 days',  make: () => ({ kind: 'range' as const, from: daysAgo(29), to: todaySB(), label: '30 Days' }) },
    { label: 'Last 90 days',  make: () => ({ kind: 'window' as const, window: 90,  label: '90 Days' }) },
    { label: 'Last 180 days', make: () => ({ kind: 'window' as const, window: 180, label: '180 Days' }) },
    { label: 'Last 12 months',make: () => ({ kind: 'window' as const, window: 365, label: '12 Months' }) },
  ];

  const apply = (r: SBDateRange) => { onChange(r); setOpen(false); };
  const applyCustom = () => {
    if (!cfrom || !cto) return;
    const [f, t] = cfrom <= cto ? [cfrom, cto] : [cto, cfrom];
    const diff = Math.round((new Date(t).getTime() - new Date(f).getTime()) / 86400000) + 1;
    apply({ kind: 'range', from: f, to: t, label: diff === 1 ? f : `${f} → ${t}` });
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', borderRadius: 7, border: `1px solid ${open ? 'var(--sv-action)' : 'var(--sv-etch)'}`, background: open ? 'var(--sv-action)' : 'var(--sv-bg-0)', color: open ? '#fff' : 'var(--sv-text-main)', cursor: 'pointer', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        {value.label}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>

      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 500, background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.18)', width: 248, overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--sv-etch)' }}>
            {(['presets', 'custom'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: tab === t ? 700 : 400, background: tab === t ? 'var(--sv-action)' : 'var(--sv-bg-2)', color: tab === t ? '#fff' : 'var(--sv-text-dim)' }}>
                {t === 'presets' ? 'Presets' : 'Custom Range'}
              </button>
            ))}
          </div>

          {tab === 'presets' ? (
            <div style={{ padding: 6 }}>
              {presets.map(p => {
                const active = value.label === p.label;
                return (
                  <button key={p.label} onClick={() => apply(p.make())} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', border: 'none', borderRadius: 6, background: active ? 'color-mix(in srgb, var(--sv-action) 15%, transparent)' : 'none', color: active ? 'var(--sv-action)' : 'var(--sv-text-main)', fontWeight: active ? 600 : 400, cursor: 'pointer', fontSize: 13 }}>
                    {p.label}{active && <span style={{ float: 'right', fontSize: 10 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: '12px 14px' }}>
              {(['From', 'To'] as const).map((lbl, idx) => {
                const val = idx === 0 ? cfrom : cto;
                const set = idx === 0 ? setCfrom : setCto;
                return (
                  <div key={lbl} style={{ marginBottom: 10 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: .5 }}>{lbl}</label>
                    <input type="date" value={val} onChange={e => set(e.target.value)} style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', fontSize: 13, boxSizing: 'border-box' as const }} />
                  </div>
                );
              })}
              <button onClick={applyCustom} disabled={!cfrom || !cto} style={{ width: '100%', padding: '7px 0', border: 'none', borderRadius: 6, background: 'var(--sv-action)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: (!cfrom || !cto) ? 'not-allowed' : 'pointer', opacity: (!cfrom || !cto) ? .5 : 1 }}>Apply</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
