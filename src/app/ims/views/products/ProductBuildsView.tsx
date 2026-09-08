'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Boxes, Check, Eye, Loader2, Plus, RotateCcw, Trash2, X } from 'lucide-react';

import { useTableArrowScroll } from '../../hooks/useTableArrowScroll';

type Recipe = {
  id: number; productId: string; productName: string; outputVariantId: string; outputSku: string | null;
  outputLabel: string; revision: number; overheadPerOutput: number; isEnabled: boolean;
  components: Array<{ variantId: string; label: string; sku: string | null; quantityPerOutput: number; averageCost: number }>;
};
type Location = { id: number; name: string; is_active?: number };
type BuildRow = { outputVariantId: string; quantity: string; overhead: string; sourceLineId?: string };
type Preview = {
  canComplete: boolean;
  builds: Array<{ outputVariantId: string; quantity: number; recipeRevision: number; overheadPerOutput: number; outputUnitCost: number }>;
  components: Array<{ variantId: string; onHand: number; committed: number; available: number; required: number; after: number; averageCost: number; cost: number }>;
};
type HistoryRow = {
  id: number; build_number: string; completed_at: string; location_name: string; status: string; item_count: number;
  quantity_built: number; quantity_reversed: number; total_cost: number; actor_name: string | null; source_type: string; source_id: string | null;
};
type Requirement = {
  id: number; sales_order_id: number; sales_order_item_id: number; location_id: number; output_variant_id: string;
  source_channel: string; detected_shortfall: number; state: string; so_number: string; product_name: string; sku: string | null; current_recipe_revision: number;
};
type BuildDetail = HistoryRow & {
  notes: string | null;
  items: Array<{
    id: number; output_variant_id: string; product_name: string; sku: string | null; recipe_revision: number;
    quantity_built: number; quantity_reversed: number; component_cost_total: number; overhead_per_output: number; output_unit_cost: number;
    output_avg_cost_before: number; output_avg_cost_after: number;
    components: Array<{ id: number; product_name: string; sku: string | null; quantity_per_output: number; quantity_consumed: number; component_avg_cost: number; component_cost_total: number }>;
    reversals: Array<{ id: number; reversal_number: string; quantity_reversed: number; reason: string; actor_name: string | null; reversed_at: string }>;
  }>;
};

const panel: React.CSSProperties = { border: '1px solid var(--sv-etch)', borderRadius: 8, background: 'var(--sv-bg-1)' };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', padding: '8px 10px', fontSize: 12 };
const button = (kind: 'primary' | 'secondary' | 'danger' = 'secondary'): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, border: kind === 'primary' ? 0 : '1px solid var(--sv-etch)', borderRadius: 6, padding: '8px 11px', background: kind === 'primary' ? 'var(--sv-action)' : kind === 'danger' ? 'var(--sv-red-tint)' : 'var(--sv-bg-1)', color: kind === 'primary' ? '#fff' : kind === 'danger' ? 'var(--sv-red)' : 'var(--sv-text-main)', fontSize: 12, fontWeight: 700, cursor: 'pointer' });
const qty = (value: unknown) => Number(value ?? 0).toLocaleString('en-AU', { maximumFractionDigits: 4 });
const money = (value: unknown) => Number(value ?? 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
const dateTime = (value: string) => value ? new Date(value).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(15,23,42,.5)', display: 'grid', placeItems: 'center', padding: 16 }} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={title} style={{ width: wide ? 'min(1040px, 96vw)' : 'min(620px, 96vw)', maxHeight: '92vh', overflowY: 'auto', ...panel, boxShadow: '0 24px 64px rgba(15,23,42,.28)' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--sv-etch)', background: 'var(--sv-bg-1)' }}><strong style={{ color: 'var(--sv-text-strong)', fontSize: 15 }}>{title}</strong><button type="button" onClick={onClose} title="Close" style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: 'var(--sv-text-dim)', cursor: 'pointer', padding: 4 }}><X size={18} /></button></div>
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  </div>;
}

export function ProductBuildsView({ isAdvisor }: { isAdvisor: boolean }) {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [locationId, setLocationId] = useState('');
  const [rows, setRows] = useState<BuildRow[]>([{ outputVariantId: '', quantity: '1', overhead: '' }]);
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [operationKey, setOperationKey] = useState('');
  const [source, setSource] = useState<{ orderId: number; channel: string } | null>(null);
  const [detail, setDetail] = useState<BuildDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reverseItem, setReverseItem] = useState<BuildDetail['items'][number] | null>(null);
  const [reverseQuantity, setReverseQuantity] = useState('');
  const [reverseReason, setReverseReason] = useState('');
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  useTableArrowScroll(bodyScrollRef);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const responses = await Promise.all([
        fetch('/api/ims/builds?pageSize=100', { cache: 'no-store' }),
        fetch('/api/ims/builds/requirements?state=open&limit=200', { cache: 'no-store' }),
        fetch('/api/ims/builds/recipes', { cache: 'no-store' }),
        fetch('/api/ims/locations', { cache: 'no-store' }),
      ]);
      const json = await Promise.all(responses.map(response => response.json()));
      if (!responses[0].ok) throw new Error(json[0].error || 'Build history could not be loaded.');
      setHistory(json[0].data?.rows ?? []); setRequirements(json[1].data ?? []); setRecipes(json[2].data ?? []);
      setLocations((json[3].data ?? []).filter((item: Location) => Number(item.is_active ?? 1) !== 0));
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const recipeByVariant = useMemo(() => new Map(recipes.map(recipe => [recipe.outputVariantId, recipe])), [recipes]);
  const componentLabels = useMemo(() => new Map(recipes.flatMap(recipe => recipe.components.map(component => [component.variantId, `${component.label}${component.sku ? ` (${component.sku})` : ''}`] as const))), [recipes]);
  const validRows = useMemo(() => rows.filter(row => row.outputVariantId && Number(row.quantity) > 0), [rows]);
  const duplicateOutputs = new Set(validRows.map(row => row.outputVariantId).filter((id, index, all) => all.indexOf(id) !== index));

  useEffect(() => {
    setPreview(null);
    if (!showNew || !locationId || !validRows.length || validRows.length !== rows.length || duplicateOutputs.size) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewing(true); setError('');
      try {
        const response = await fetch('/api/ims/builds/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ locationId: Number(locationId), sourceType: source ? 'sales_order' : 'manual', sourceId: source?.orderId ?? null, sourceChannel: source?.channel ?? null, notes, builds: validRows.map(row => ({ outputVariantId: row.outputVariantId, quantity: Number(row.quantity), overheadPerOutput: row.overhead === '' ? undefined : Number(row.overhead), sourceLineId: row.sourceLineId, recipeRevision: recipeByVariant.get(row.outputVariantId)?.revision })) }) });
        const json = await response.json(); if (!response.ok) throw new Error(json.error || 'Build preview failed.'); setPreview(json.data);
      } catch (caught) { if ((caught as Error).name !== 'AbortError') setError(caught instanceof Error ? caught.message : String(caught)); }
      finally { if (!controller.signal.aborted) setPreviewing(false); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [duplicateOutputs.size, locationId, notes, recipeByVariant, rows, showNew, source, validRows]);

  const startNew = (requirement?: Requirement) => {
    setError(''); setPreview(null); setOperationKey(crypto.randomUUID()); setNotes('');
    if (requirement) { setLocationId(String(requirement.location_id)); setRows([{ outputVariantId: requirement.output_variant_id, quantity: String(requirement.detected_shortfall), overhead: '', sourceLineId: String(requirement.sales_order_item_id) }]); setSource({ orderId: requirement.sales_order_id, channel: requirement.source_channel }); }
    else { setLocationId(locations.length === 1 ? String(locations[0].id) : ''); setRows([{ outputVariantId: '', quantity: '1', overhead: '' }]); setSource(null); }
    setShowNew(true);
  };

  const openDetail = async (id: number) => {
    setDetailLoading(true); setError('');
    try { const response = await fetch(`/api/ims/builds/${id}`, { cache: 'no-store' }); const json = await response.json(); if (!response.ok) throw new Error(json.error || 'Build detail could not be loaded.'); setDetail(json.data); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setDetailLoading(false); }
  };

  useEffect(() => {
    const match = window.location.hash.replace(/^#/, '').match(/^builds\/(\d+)$/);
    if (match) void openDetail(Number(match[1]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmBuild = async () => {
    if (!preview?.canComplete || submitting) return;
    setSubmitting(true); setError('');
    try {
      const response = await fetch('/api/ims/builds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locationId: Number(locationId), operationKey, sourceType: source ? 'sales_order' : 'manual', sourceId: source?.orderId ?? null, sourceChannel: source?.channel ?? null, notes, builds: validRows.map(row => ({ outputVariantId: row.outputVariantId, quantity: Number(row.quantity), overheadPerOutput: row.overhead === '' ? undefined : Number(row.overhead), sourceLineId: row.sourceLineId, recipeRevision: recipeByVariant.get(row.outputVariantId)?.revision })) }) });
      const json = await response.json(); if (!response.ok) throw new Error(json.error || 'Build could not be completed.'); setShowNew(false); await load(); await openDetail(Number(json.data.batchId));
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSubmitting(false); }
  };

  const submitReversal = async () => {
    if (!reverseItem || !reverseReason.trim() || Number(reverseQuantity) <= 0) return;
    setSubmitting(true); setError('');
    try { const response = await fetch(`/api/ims/builds/items/${reverseItem.id}/reverse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: Number(reverseQuantity), reason: reverseReason.trim(), operationKey: crypto.randomUUID() }) }); const json = await response.json(); if (!response.ok) throw new Error(json.error || 'Build reversal failed.'); const batchId = Number(detail?.id); setReverseItem(null); setReverseReason(''); await load(); if (batchId) await openDetail(batchId); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSubmitting(false); }
  };

  const renderColGroup = () => <colgroup><col style={{ width: 150 }} /><col style={{ width: 165 }} /><col style={{ width: 180 }} /><col style={{ width: 110 }} /><col style={{ width: 130 }} /><col style={{ width: 125 }} /><col style={{ width: 145 }} /><col style={{ width: 90 }} /></colgroup>;
  const tableStyle: React.CSSProperties = { width: 1095, tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 };
  const cell: React.CSSProperties = { padding: '9px 11px', borderBottom: '1px solid var(--sv-etch)', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

  return <section style={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}><div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(30,168,194,.12)', color: 'var(--sv-action)', display: 'grid', placeItems: 'center' }}><Boxes size={19} /></div><div><h1 style={{ margin: 0, fontSize: 20, color: 'var(--sv-text-strong)' }}>Product Builds</h1><p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--sv-text-dim)' }}>Build finished products from saved component recipes.</p></div><button type="button" onClick={() => startNew()} disabled={isAdvisor || !recipes.length} title={isAdvisor ? 'Advisor accounts are read-only' : !recipes.length ? 'Save an active build recipe first' : 'Create a product build'} style={{ ...button('primary'), marginLeft: 'auto', opacity: isAdvisor || !recipes.length ? .55 : 1 }}><Plus size={15} />New Build</button></div>
    {error && <div role="alert" style={{ marginBottom: 14, padding: '10px 12px', border: '1px solid rgba(220,38,38,.25)', borderRadius: 6, background: 'var(--sv-red-tint)', color: 'var(--sv-red)', fontSize: 12 }}>{error}</div>}
    {requirements.length > 0 && <div style={{ ...panel, marginBottom: 18, overflow: 'hidden' }}><div style={{ padding: '11px 14px', borderBottom: '1px solid var(--sv-etch)', display: 'flex', alignItems: 'center', gap: 8 }}><AlertTriangle size={15} color="#d97706" /><strong style={{ fontSize: 13 }}>Build for Order</strong><span style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}>{requirements.length} open</span></div>{requirements.map(item => <div key={item.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 130px 120px 110px', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--sv-etch)', fontSize: 12 }}><div><strong>{item.product_name}</strong>{item.sku && <span style={{ color: 'var(--sv-text-dim)', marginLeft: 6 }}>{item.sku}</span>}<div style={{ color: 'var(--sv-text-dim)', marginTop: 2 }}>{item.source_channel.replaceAll('_', ' ')}</div></div><a href={`#sales-orders/${item.sales_order_id}`} style={{ color: 'var(--sv-action)', fontWeight: 700 }}>{item.so_number}</a><span>{qty(item.detected_shortfall)} required</span><button type="button" disabled={isAdvisor} onClick={() => startNew(item)} style={button()}>Build item</button></div>)}</div>}
    <div style={{ ...panel, overflow: 'hidden' }}><div style={{ padding: '11px 14px', borderBottom: '1px solid var(--sv-etch)', display: 'flex', alignItems: 'center' }}><strong style={{ fontSize: 13 }}>Build history</strong>{loading && <Loader2 size={14} className="animate-spin" style={{ marginLeft: 8 }} />}</div><div ref={headerScrollRef} style={{ position: 'sticky', top: 0, overflow: 'hidden', background: 'var(--sv-bg-2)', zIndex: 2 }}><table style={tableStyle}>{renderColGroup()}<thead><tr>{['Build','Completed','Location','Outputs','Quantity','Status','Actor',''].map(label => <th key={label} style={cell}>{label}</th>)}</tr></thead></table></div><div ref={bodyScrollRef} className="ims-sticky-table ims-sticky-table--self-scroll product-builds-scroll" role="region" aria-label="Build history. Use arrow keys to scroll." tabIndex={0} onScroll={event => { if (headerScrollRef.current) headerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft; }} style={{ overflowX: 'auto', overflowY: 'hidden' }}><table style={tableStyle}>{renderColGroup()}<tbody>{history.map(row => <tr key={row.id}><td style={{ ...cell, position: 'sticky', left: 0, zIndex: 1, background: 'var(--sv-bg-1)', boxShadow: '1px 0 var(--sv-etch)' }}><button onClick={() => openDetail(row.id)} style={{ border: 0, background: 'none', color: 'var(--sv-action)', fontWeight: 700, cursor: 'pointer', padding: 0 }}>{row.build_number}</button></td><td style={cell}>{dateTime(row.completed_at)}</td><td style={cell}>{row.location_name}</td><td style={cell}>{row.item_count}</td><td style={cell}>{qty(row.quantity_built)}</td><td style={cell}>{row.status.replaceAll('_', ' ')}</td><td style={cell}>{row.actor_name || 'System'}</td><td style={cell}><button title="View build" onClick={() => openDetail(row.id)} style={{ ...button(), padding: 5 }}><Eye size={14} /></button></td></tr>)}{!loading && !history.length && <tr><td colSpan={8} style={{ ...cell, textAlign: 'center', padding: 28, color: 'var(--sv-text-dim)' }}>No completed builds yet.</td></tr>}</tbody></table></div></div>

    {showNew && <Dialog title={source ? `Build for order ${source.orderId}` : 'New Product Build'} onClose={() => setShowNew(false)} wide><div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 260px) 1fr', gap: 14, marginBottom: 14 }}><label style={{ fontSize: 12, fontWeight: 700 }}>Location<select value={locationId} disabled={Boolean(source)} onChange={event => setLocationId(event.target.value)} style={{ ...input, marginTop: 5 }}><option value="">Select location</option>{locations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label style={{ fontSize: 12, fontWeight: 700 }}>Build notes<textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} style={{ ...input, marginTop: 5, resize: 'vertical' }} /></label></div><div style={{ ...panel, overflowX: 'auto', marginBottom: 14 }}><table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 12 }}><thead><tr style={{ background: 'var(--sv-bg-2)' }}><th style={cell}>Recipe output</th><th style={{ ...cell, width: 130 }}>Quantity</th><th style={{ ...cell, width: 160 }}>Overhead / output</th><th style={{ ...cell, width: 55 }} /></tr></thead><tbody>{rows.map((row, index) => <tr key={index}><td style={cell}><select value={row.outputVariantId} disabled={Boolean(row.sourceLineId)} onChange={event => setRows(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, outputVariantId: event.target.value } : item))} style={input}><option value="">Select recipe</option>{recipes.map(recipe => <option key={recipe.outputVariantId} value={recipe.outputVariantId}>{recipe.outputLabel}{recipe.outputSku ? ` (${recipe.outputSku})` : ''} · rev {recipe.revision}</option>)}</select>{duplicateOutputs.has(row.outputVariantId) && <div style={{ color: 'var(--sv-red)', marginTop: 4 }}>Each output can appear once.</div>}</td><td style={cell}><input type="number" min="0.0001" step="0.0001" value={row.quantity} onChange={event => setRows(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} style={input} /></td><td style={cell}><input type="number" min="0" step="0.01" placeholder={money(recipeByVariant.get(row.outputVariantId)?.overheadPerOutput ?? 0)} value={row.overhead} onChange={event => setRows(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, overhead: event.target.value } : item))} style={input} /></td><td style={cell}><button type="button" title="Remove output" disabled={rows.length === 1 || Boolean(row.sourceLineId)} onClick={() => setRows(current => current.filter((_, itemIndex) => itemIndex !== index))} style={{ ...button('danger'), padding: 6 }}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div>{!source && <button type="button" onClick={() => setRows(current => [...current, { outputVariantId: '', quantity: '1', overhead: '' }])} style={{ ...button(), marginBottom: 16 }}><Plus size={14} />Add output</button>}{previewing && <div style={{ color: 'var(--sv-text-dim)', fontSize: 12, marginBottom: 12 }}><Loader2 size={13} className="animate-spin" style={{ verticalAlign: 'middle', marginRight: 6 }} />Checking components and costs...</div>}{preview && <div style={{ ...panel, overflowX: 'auto', marginBottom: 16 }}><table style={{ width: '100%', minWidth: 850, borderCollapse: 'collapse', fontSize: 12 }}><thead><tr style={{ background: 'var(--sv-bg-2)' }}>{['Component','On hand','Committed','Available','Required','After','Avg cost','Value'].map(label => <th key={label} style={cell}>{label}</th>)}</tr></thead><tbody>{preview.components.map(component => <tr key={component.variantId}><td style={cell}>{componentLabels.get(component.variantId) || component.variantId}</td><td style={cell}>{qty(component.onHand)}</td><td style={cell}>{qty(component.committed)}</td><td style={cell}>{qty(component.available)}</td><td style={cell}>{qty(component.required)}</td><td style={{ ...cell, color: component.after < 0 ? 'var(--sv-red)' : 'var(--sv-mint)', fontWeight: 700 }}>{qty(component.after)}</td><td style={cell}>{money(component.averageCost)}</td><td style={cell}>{money(component.cost)}</td></tr>)}</tbody></table><div style={{ padding: '10px 12px', borderTop: '1px solid var(--sv-etch)', display: 'flex', gap: 18, flexWrap: 'wrap' }}>{preview.builds.map(item => <span key={item.outputVariantId} style={{ fontSize: 12 }}><strong>{recipeByVariant.get(item.outputVariantId)?.outputLabel}</strong>: {money(item.outputUnitCost)} / output, {money(item.overheadPerOutput)} overhead</span>)}</div></div>}<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button type="button" onClick={() => setShowNew(false)} style={button()}>Cancel</button><button type="button" disabled={!preview?.canComplete || submitting || previewing || duplicateOutputs.size > 0} onClick={confirmBuild} style={{ ...button('primary'), opacity: !preview?.canComplete || submitting ? .55 : 1 }}>{submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}Confirm atomic build</button></div></Dialog>}

    {(detail || detailLoading) && <Dialog title={detail?.build_number || 'Loading build'} onClose={() => setDetail(null)} wide>{detailLoading && !detail ? <div style={{ padding: 30, textAlign: 'center' }}><Loader2 className="animate-spin" /></div> : detail && <><div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 16, fontSize: 12 }}><span><strong>Completed:</strong> {dateTime(detail.completed_at)}</span><span><strong>Location:</strong> {detail.location_name}</span><span><strong>Status:</strong> {detail.status.replaceAll('_', ' ')}</span><span><strong>Actor:</strong> {detail.actor_name || 'System'}</span>{detail.source_id && <a href={`#sales-orders/${detail.source_id}`} style={{ color: 'var(--sv-action)', fontWeight: 700 }}>Open source order</a>}</div>{detail.items.map(item => { const remaining = Number(item.quantity_built) - Number(item.quantity_reversed); return <div key={item.id} style={{ ...panel, marginBottom: 14, overflow: 'hidden' }}><div style={{ padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--sv-bg-2)' }}><strong>{item.product_name}{item.sku ? ` (${item.sku})` : ''}</strong><span style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}>recipe rev {item.recipe_revision}</span><span style={{ marginLeft: 'auto', fontSize: 12 }}>{qty(item.quantity_built)} built · {qty(item.quantity_reversed)} reversed · {money(item.output_unit_cost)} / output</span>{remaining > 0 && !isAdvisor && <button type="button" onClick={() => { setReverseItem(item); setReverseQuantity(String(remaining)); }} style={button('danger')}><RotateCcw size={14} />Reverse</button>}</div><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 12 }}><thead><tr>{['Component','Per output','Consumed','Captured cost','Value'].map(label => <th key={label} style={cell}>{label}</th>)}</tr></thead><tbody>{item.components.map(component => <tr key={component.id}><td style={cell}>{component.product_name}{component.sku ? ` (${component.sku})` : ''}</td><td style={cell}>{qty(component.quantity_per_output)}</td><td style={cell}>{qty(component.quantity_consumed)}</td><td style={cell}>{money(component.component_avg_cost)}</td><td style={cell}>{money(component.component_cost_total)}</td></tr>)}</tbody></table></div>{item.reversals.map(reversal => <div key={reversal.id} style={{ padding: '9px 13px', borderTop: '1px solid var(--sv-etch)', fontSize: 11 }}><strong>{reversal.reversal_number}</strong> · {qty(reversal.quantity_reversed)} · {reversal.reason} · {dateTime(reversal.reversed_at)}</div>)}</div>; })}<button type="button" onClick={() => setDetail(null)} style={button()}><ArrowLeft size={14} />Back to builds</button></>}</Dialog>}

    {reverseItem && <Dialog title={`Reverse ${reverseItem.product_name}`} onClose={() => setReverseItem(null)}><p style={{ marginTop: 0, fontSize: 12, color: 'var(--sv-text-dim)' }}>This removes finished available stock and restores the original component proportions at their captured costs.</p><label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 12 }}>Quantity (maximum {qty(Number(reverseItem.quantity_built) - Number(reverseItem.quantity_reversed))})<input type="number" min="0.0001" max={Number(reverseItem.quantity_built) - Number(reverseItem.quantity_reversed)} step="0.0001" value={reverseQuantity} onChange={event => setReverseQuantity(event.target.value)} style={{ ...input, marginTop: 5 }} /></label><label style={{ display: 'block', fontSize: 12, fontWeight: 700 }}>Reason *<textarea value={reverseReason} onChange={event => setReverseReason(event.target.value)} rows={3} style={{ ...input, marginTop: 5, resize: 'vertical' }} /></label><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}><button onClick={() => setReverseItem(null)} style={button()}>Cancel</button><button disabled={!reverseReason.trim() || Number(reverseQuantity) <= 0 || submitting} onClick={submitReversal} style={{ ...button('danger'), opacity: !reverseReason.trim() || submitting ? .55 : 1 }}><RotateCcw size={14} />Confirm reversal</button></div></Dialog>}
  </section>;
}