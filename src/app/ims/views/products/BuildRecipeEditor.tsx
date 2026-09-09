'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Plus, Save, Search, Trash2 } from 'lucide-react';

type Variant = { variant_id?: string; sku?: string | null; option1_value?: string | null; option2_value?: string | null; option3_value?: string | null; is_active?: number };
type ComponentSuggestion = { value: string; label: string; meta?: string; averageCost?: number };
type Recipe = {
  outputVariantId: string; revision: number; isEnabled: boolean; baseOutputQuantity: number; overheadPerOutput: number; notes: string | null;
  components: Array<{ variantId: string; label: string; sku: string | null; quantityPerOutput: number; averageCost: number }>;
};
type Line = { variantId: string; quantity: string; label?: string; cost?: number };

const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', padding: '8px 10px', fontSize: 12 };
const action: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 6, padding: '8px 11px', background: 'var(--sv-action)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' };

export function BuildRecipeEditor({ productId, outputVariants, isAdvisor }: { productId: string; outputVariants: Variant[]; isAdvisor: boolean }) {
  const savedOutputs = outputVariants.filter(variant => variant.variant_id && Number(variant.is_active ?? 1) !== 0);
  const [outputId, setOutputId] = useState(savedOutputs[0]?.variant_id ?? '');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [lines, setLines] = useState<Line[]>([{ variantId: '', quantity: '1' }]);
  const [overhead, setOverhead] = useState('0');
  const [notes, setNotes] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<ComponentSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/ims/products/${encodeURIComponent(productId)}/build-recipes`, { cache: 'no-store' }).then(response => response.json())
      .then(recipeJson => { if (active) setRecipes(recipeJson.data ?? []); })
      .catch(error => { if (active) setMessage(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productId]);

  const activeRecipe = recipes.find(recipe => recipe.outputVariantId === outputId);
  useEffect(() => {
    if (activeRecipe) { setLines(activeRecipe.components.map(component => ({ variantId: component.variantId, quantity: String(component.quantityPerOutput), label: component.label, cost: component.averageCost }))); setOverhead(String(activeRecipe.overheadPerOutput)); setNotes(activeRecipe.notes ?? ''); setEnabled(activeRecipe.isEnabled); }
    else { setLines([{ variantId: '', quantity: '1' }]); setOverhead('0'); setNotes(''); setEnabled(true); }
  }, [activeRecipe, outputId]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const query = search.trim();
    if (!query) { setSuggestions([]); setSearching(false); return; }
    const controller = new AbortController();
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/ims/filters/search?only=product&stock=1&q=${encodeURIComponent(query)}&limit=25`, { signal: controller.signal });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || 'Products could not be searched.');
        setSuggestions((json.suggestions ?? []).filter((candidate: ComponentSuggestion) => candidate.value !== outputId));
      } catch (error: any) {
        if (error?.name !== 'AbortError') setMessage(error instanceof Error ? error.message : String(error));
      } finally { setSearching(false); }
    }, 250);
    return () => { controller.abort(); if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [outputId, search]);

  const chooseComponent = (candidate: ComponentSuggestion) => {
    setLines(current => {
      const blankIndex = current.findIndex(line => !line.variantId);
      const nextLine = { variantId: candidate.value, quantity: '1', label: candidate.label.replace(/^Product:\s*/i, ''), cost: Number(candidate.averageCost ?? 0) };
      if (blankIndex < 0) return [...current, nextLine];
      return current.map((line, index) => index === blankIndex ? nextLine : line);
    });
    setSearch('');
    setSuggestions([]);
  };
  const currentCost = lines.reduce((total, line) => total + Number(line.quantity || 0) * Number(line.cost ?? 0), 0) + Number(overhead || 0);

  const save = async () => {
    setSaving(true); setMessage('');
    try {
      const response = await fetch(`/api/ims/products/${encodeURIComponent(productId)}/build-recipes`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outputVariantId: outputId, components: lines.filter(line => line.variantId).map(line => ({ variantId: line.variantId, quantityPerOutput: Number(line.quantity) })), baseOutputQuantity: 1, overheadPerOutput: Number(overhead || 0), notes, isEnabled: enabled, expectedRevision: activeRecipe?.revision ?? 0 }) });
      const json = await response.json(); if (!response.ok) throw new Error(json.error || 'Recipe could not be saved.');
      setRecipes(current => [...current.filter(recipe => recipe.outputVariantId !== outputId), json.data]); setMessage(`Revision ${json.data.revision} saved.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };

  if (!savedOutputs.length) return <div style={{ padding: 12, border: '1px solid var(--sv-etch)', borderRadius: 8, color: 'var(--sv-text-dim)', fontSize: 12 }}>Save at least one active variant before creating a build recipe.</div>;
  return <div style={{ border: '1px solid var(--sv-etch)', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
    <div style={{ padding: '12px 14px', background: 'var(--sv-bg-2)', borderBottom: '1px solid var(--sv-etch)', display: 'flex', alignItems: 'center', gap: 10 }}><strong style={{ fontSize: 13 }}>Build Recipe</strong>{activeRecipe && <span style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>revision {activeRecipe.revision}</span>}<label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}><input type="checkbox" checked={enabled} disabled={isAdvisor} onChange={event => setEnabled(event.target.checked)} />Enabled</label></div>
    <div style={{ padding: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 12 }}>Output variant<select value={outputId} onChange={event => setOutputId(event.target.value)} style={{ ...field, marginTop: 5 }}>{savedOutputs.map(variant => <option key={variant.variant_id} value={variant.variant_id}>{[variant.sku, variant.option1_value, variant.option2_value, variant.option3_value].filter(Boolean).join(' / ') || 'Default variant'}</option>)}</select></label>
      <div style={{ position: 'relative', marginBottom: 8 }}><Search size={14} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--sv-text-dim)' }} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search components by product, variant, SKU or barcode" style={{ ...field, paddingLeft: 30 }} />{searching && <span style={{ position: 'absolute', right: 9, top: 8, color: 'var(--sv-text-dim)', fontSize: 11 }}>Searching...</span>}{suggestions.length > 0 && <div style={{ position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 240, overflowY: 'auto', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', boxShadow: '0 8px 24px rgba(0,0,0,.16)' }}>{suggestions.map(candidate => <button key={candidate.value} type="button" onMouseDown={() => chooseComponent(candidate)} style={{ display: 'block', width: '100%', padding: '8px 10px', border: 0, borderBottom: '1px solid var(--sv-etch)', background: 'transparent', color: 'var(--sv-text-main)', textAlign: 'left', cursor: 'pointer' }}><span style={{ display: 'block', fontSize: 12, fontWeight: 650 }}>{candidate.label.replace(/^Product:\s*/i, '')}</span>{candidate.meta && <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--sv-text-dim)' }}>{candidate.meta}</span>}</button>)}</div>}</div>
      <div style={{ display: 'grid', gap: 7 }}>{lines.map((line, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 110px 90px 34px', gap: 8, alignItems: 'center' }}><div style={{ ...field, minHeight: 34, color: line.variantId ? 'var(--sv-text-main)' : 'var(--sv-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.label || 'Search above to select a component'}</div><input type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={event => setLines(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} style={field} title="Quantity per output" /><span style={{ fontSize: 11, textAlign: 'right' }}>{Number(line.cost ?? 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })}</span><button type="button" title="Remove component" disabled={lines.length === 1} onClick={() => setLines(current => current.filter((_, itemIndex) => itemIndex !== index))} style={{ border: '1px solid var(--sv-etch)', borderRadius: 5, background: 'var(--sv-bg-1)', color: 'var(--sv-red)', padding: 6, cursor: 'pointer' }}><Trash2 size={13} /></button></div>)}</div>
      <button type="button" onClick={() => setLines(current => [...current, { variantId: '', quantity: '1' }])} style={{ ...action, background: 'var(--sv-bg-1)', color: 'var(--sv-action)', border: '1px solid var(--sv-etch)', marginTop: 9 }}><Plus size={14} />Add component</button>
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, marginTop: 14 }}><label style={{ fontSize: 12, fontWeight: 700 }}>Overhead per output<input type="number" min="0" step="0.01" value={overhead} onChange={event => setOverhead(event.target.value)} style={{ ...field, marginTop: 5 }} /></label><label style={{ fontSize: 12, fontWeight: 700 }}>Revision notes<input value={notes} onChange={event => setNotes(event.target.value)} style={{ ...field, marginTop: 5 }} /></label></div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 12 }}><span style={{ fontSize: 12 }}><strong>Current output cost:</strong> {currentCost.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })}</span>{message && <span role="status" style={{ marginLeft: 12, fontSize: 11, color: message.includes('saved') ? 'var(--sv-mint)' : 'var(--sv-red)' }}>{message}</span>}<button type="button" disabled={isAdvisor || loading || saving || !outputId || lines.some(line => !line.variantId || Number(line.quantity) <= 0)} onClick={save} style={{ ...action, marginLeft: 'auto', opacity: isAdvisor || saving ? .55 : 1 }}><Save size={14} />{saving ? 'Saving...' : 'Save New Revision'}</button></div>
    </div>
  </div>;
}