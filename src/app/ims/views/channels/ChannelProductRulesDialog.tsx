'use client';

import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

type OverrideMode = 'automatic' | 'include' | 'exclude';
type Decision = 'include' | 'exclude';
type MatchMode = 'all' | 'any';

type Condition = { field: string; operator: string; value?: string | number | boolean | string[] };
type Rule = { id?: number | string; name: string; priority?: number; enabled: boolean; matchMode: MatchMode; decision: Decision; conditions: Condition[] };
type ProductEvaluation = {
  productId: string;
  productName: string;
  onlineCandidate: boolean;
  ruleDecision: Decision;
  effectiveDecision: Decision;
  matchedRuleName: string | null;
  overrideMode: OverrideMode;
  providerState: string;
};

const FIELDS = [
  ['online_candidate', 'Online candidate'], ['active', 'Product active'], ['stock_item', 'Stock tracked'],
  ['description', 'Description'], ['website_title', 'Website title'], ['product_type', 'Product type'],
  ['category', 'Category'], ['subcategory', 'Subcategory'], ['brand', 'Brand'], ['tags', 'Tags'],
  ['image_count', 'Image count'], ['variant_count', 'Active variant count'],
] as const;
const OPERATORS = [
  ['equals', 'equals'], ['not_equals', 'does not equal'], ['is_present', 'is present'],
  ['is_not_present', 'is not present'], ['contains', 'contains'], ['not_contains', 'does not contain'],
  ['in', 'is one of'], ['not_in', 'is not one of'], ['greater_than_or_equal', 'is at least'],
] as const;
const BOOLEAN_FIELDS = new Set(['online_candidate', 'active', 'stock_item']);
const NUMBER_FIELDS = new Set(['image_count', 'variant_count']);
const VALUELESS_OPERATORS = new Set(['is_present', 'is_not_present']);

const emptyRule = (): Rule => ({
  name: 'New rule', enabled: true, matchMode: 'all', decision: 'include',
  conditions: [{ field: 'online_candidate', operator: 'equals', value: true }],
});

function serializedRules(rules: Rule[]) {
  return rules.map(rule => ({ ...rule, conditions: rule.conditions.map(condition => ({
    ...condition,
    value: condition.operator === 'in' || condition.operator === 'not_in'
      ? String(condition.value ?? '').split(',').map(value => value.trim()).filter(Boolean)
      : condition.value,
  })) }));
}

export default function ChannelProductRulesDialog({ instance, onClose, onApplied }: {
  instance: { channelInstanceId: string; displayName: string; providerDisplayName: string };
  onClose: () => void;
  onApplied: () => Promise<void>;
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [products, setProducts] = useState<ProductEvaluation[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const endpoint = `/api/ims/channels/${encodeURIComponent(instance.channelInstanceId)}/product-rules`;

  const load = async (query = search) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${endpoint}?limit=100&search=${encodeURIComponent(query)}`);
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Channel product rules could not be loaded.');
      setRules(Array.isArray(body.rules) ? body.rules : []);
      setProducts(Array.isArray(body.products) ? body.products : []);
      setTotal(Number(body.total ?? 0));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Channel product rules could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(''); }, []);

  const updateRule = (index: number, change: Partial<Rule>) => {
    setRules(current => current.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...change } : rule));
  };

  const updateCondition = (ruleIndex: number, conditionIndex: number, change: Partial<Condition>) => {
    setRules(current => current.map((rule, currentRuleIndex) => currentRuleIndex !== ruleIndex ? rule : {
      ...rule,
      conditions: rule.conditions.map((condition, currentConditionIndex) => currentConditionIndex === conditionIndex
        ? { ...condition, ...change }
        : condition),
    }));
  };

  const moveRule = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;
    setRules(current => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const saveRules = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(endpoint, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: serializedRules(rules) }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Channel product rules could not be saved.');
      setRules(Array.isArray(body.rules) ? body.rules : []);
      setProducts(Array.isArray(body.products) ? body.products : []);
      setTotal(Number(body.total ?? 0));
      setNotice('Rules saved. Review the preview before applying assignments.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Channel product rules could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const applyAssignments = async () => {
    if (!window.confirm(`Apply these rules to all ${total} products for ${instance.displayName}? This records destination intent but does not publish products.`)) return;
    setApplying(true);
    setError('');
    setNotice('');
    try {
      let offset = 0;
      let applied = 0;
      let catalogueTotal: number | null = null;
      do {
        const response = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apply: true, limit: 500, offset }),
        });
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || 'Channel assignments could not be applied.');
        applied += Number(body.applied ?? 0);
        catalogueTotal = Number(body.total ?? 0);
        offset += 500;
      } while (offset < (catalogueTotal ?? 0));
      setNotice(`${applied} product assignments evaluated. No products were published.`);
      await load(search);
      await onApplied();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Channel assignments could not be applied.');
    } finally {
      setApplying(false);
    }
  };

  const setOverride = async (productId: string, overrideMode: OverrideMode) => {
    setError('');
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId, overrideMode }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Product override could not be saved.');
      setProducts(current => current.map(product => product.productId === productId ? {
        ...product,
        overrideMode,
        effectiveDecision: overrideMode === 'automatic' ? product.ruleDecision : overrideMode,
      } : product));
    } catch (overrideError) {
      setError(overrideError instanceof Error ? overrideError.message : 'Product override could not be saved.');
    }
  };

  return <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving && !applying) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 420, background: 'rgba(15,23,42,.5)', display: 'grid', placeItems: 'center', padding: 18 }}>
    <div role="dialog" aria-modal="true" aria-labelledby="channel-product-rules-title" style={{ width: 'min(1080px, 100%)', height: 'min(820px, calc(100vh - 36px))', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff', border: '1px solid var(--sv-border)', borderRadius: 8, boxShadow: '0 24px 70px rgba(15,23,42,.28)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '19px 22px', borderBottom: '1px solid var(--sv-border)' }}>
        <div><h2 id="channel-product-rules-title" style={{ margin: 0, fontSize: 17, color: 'var(--sv-text-strong)' }}>{instance.displayName} product rules</h2><p style={{ margin: '5px 0 0', fontSize: 12, color: 'var(--sv-text-dim)' }}>Ordered rules set destination intent for {instance.providerDisplayName}. Explicit product overrides always win.</p></div>
        <button type="button" onClick={onClose} disabled={saving || applying} title="Close" aria-label="Close product rules" style={{ width: 30, height: 30, border: 0, background: '#f1f5f9', color: '#475569', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><X size={16} /></button>
      </div>
      {(error || notice) && <div style={{ padding: '9px 22px', background: error ? '#fef2f2' : '#f0fdf4', color: error ? '#991b1b' : '#166534', fontSize: 12 }}>{error || notice}</div>}
      <div style={{ flex: 1, overflow: 'auto', padding: 22 }}>
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><h3 style={{ margin: 0, fontSize: 14 }}>Ordered rules</h3><button type="button" onClick={() => setRules(current => [...current, emptyRule()])} style={{ minHeight: 32, padding: '0 10px', border: '1px solid var(--sv-border)', borderRadius: 5, background: '#fff', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}><Plus size={14} /> Add rule</button></div>
          {rules.length === 0 && <div style={{ marginTop: 12, padding: 16, border: '1px dashed var(--sv-border)', color: 'var(--sv-text-dim)', fontSize: 12 }}>No rules means products default to Exclude unless explicitly included.</div>}
          {rules.map((rule, ruleIndex) => <div key={String(rule.id ?? `new-${ruleIndex}`)} style={{ marginTop: 10, padding: 14, border: '1px solid var(--sv-border)', borderRadius: 6, background: '#f8fafc' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '34px 34px minmax(150px, 1fr) 110px 115px 92px 34px', gap: 7, alignItems: 'center' }}>
              <button type="button" onClick={() => moveRule(ruleIndex, -1)} disabled={ruleIndex === 0} title="Move rule up" aria-label="Move rule up" style={{ width: 32, height: 32, border: '1px solid var(--sv-border)', background: '#fff', display: 'grid', placeItems: 'center' }}><ArrowUp size={14} /></button>
              <button type="button" onClick={() => moveRule(ruleIndex, 1)} disabled={ruleIndex === rules.length - 1} title="Move rule down" aria-label="Move rule down" style={{ width: 32, height: 32, border: '1px solid var(--sv-border)', background: '#fff', display: 'grid', placeItems: 'center' }}><ArrowDown size={14} /></button>
              <input aria-label="Rule name" value={rule.name} maxLength={120} onChange={event => updateRule(ruleIndex, { name: event.target.value })} style={{ height: 32, border: '1px solid var(--sv-border)', borderRadius: 4, padding: '0 8px', minWidth: 0 }} />
              <select aria-label="Rule decision" value={rule.decision} onChange={event => updateRule(ruleIndex, { decision: event.target.value as Decision })} style={{ height: 32, border: '1px solid var(--sv-border)', borderRadius: 4, background: '#fff' }}><option value="include">Include</option><option value="exclude">Exclude</option></select>
              <select aria-label="Condition matching" value={rule.matchMode} onChange={event => updateRule(ruleIndex, { matchMode: event.target.value as MatchMode })} style={{ height: 32, border: '1px solid var(--sv-border)', borderRadius: 4, background: '#fff' }}><option value="all">Match all</option><option value="any">Match any</option></select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}><input type="checkbox" checked={rule.enabled} onChange={event => updateRule(ruleIndex, { enabled: event.target.checked })} /> Enabled</label>
              <button type="button" onClick={() => setRules(current => current.filter((_, index) => index !== ruleIndex))} title="Delete rule" aria-label={`Delete ${rule.name}`} style={{ width: 32, height: 32, border: '1px solid #fecaca', background: '#fff', color: '#991b1b', display: 'grid', placeItems: 'center' }}><Trash2 size={14} /></button>
            </div>
            {rule.conditions.map((condition, conditionIndex) => <div key={conditionIndex} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) minmax(135px, .8fr) minmax(150px, 1fr) 34px', gap: 7, marginTop: 8 }}>
              <select aria-label="Condition field" value={condition.field} onChange={event => { const field = event.target.value; updateCondition(ruleIndex, conditionIndex, { field, value: BOOLEAN_FIELDS.has(field) ? true : NUMBER_FIELDS.has(field) ? 1 : '' }); }} style={{ height: 32, border: '1px solid var(--sv-border)', borderRadius: 4, background: '#fff' }}>{FIELDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <select aria-label="Condition operator" value={condition.operator} onChange={event => updateCondition(ruleIndex, conditionIndex, { operator: event.target.value })} style={{ height: 32, border: '1px solid var(--sv-border)', borderRadius: 4, background: '#fff' }}>{OPERATORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              {VALUELESS_OPERATORS.has(condition.operator) ? <span /> : BOOLEAN_FIELDS.has(condition.field) ? <select aria-label="Condition value" value={String(condition.value ?? true)} onChange={event => updateCondition(ruleIndex, conditionIndex, { value: event.target.value === 'true' })} style={{ height: 32, border: '1px solid var(--sv-border)', borderRadius: 4, background: '#fff' }}><option value="true">Yes</option><option value="false">No</option></select> : <input aria-label="Condition value" type={NUMBER_FIELDS.has(condition.field) ? 'number' : 'text'} value={Array.isArray(condition.value) ? condition.value.join(', ') : String(condition.value ?? '')} onChange={event => updateCondition(ruleIndex, conditionIndex, { value: NUMBER_FIELDS.has(condition.field) ? Number(event.target.value) : event.target.value })} placeholder={condition.operator === 'in' || condition.operator === 'not_in' ? 'Comma-separated values' : 'Value'} style={{ height: 32, border: '1px solid var(--sv-border)', borderRadius: 4, padding: '0 8px', minWidth: 0 }} />}
              <button type="button" onClick={() => updateRule(ruleIndex, { conditions: rule.conditions.filter((_, index) => index !== conditionIndex) })} disabled={rule.conditions.length === 1} title="Remove condition" aria-label="Remove condition" style={{ width: 32, height: 32, border: '1px solid var(--sv-border)', background: '#fff', display: 'grid', placeItems: 'center' }}><X size={14} /></button>
            </div>)}
            <button type="button" onClick={() => updateRule(ruleIndex, { conditions: [...rule.conditions, { field: 'online_candidate', operator: 'equals', value: true }] })} style={{ marginTop: 8, padding: 0, border: 0, background: 'transparent', color: '#0369a1', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>+ Add condition</button>
          </div>)}
        </section>
        <section style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><h3 style={{ margin: 0, fontSize: 14 }}>Product preview</h3><div style={{ marginTop: 4, color: 'var(--sv-text-dim)', fontSize: 11 }}>{total} products · first matching rule wins · overrides persist</div></div><div style={{ display: 'flex', gap: 7 }}><input aria-label="Search products" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void load(search); }} placeholder="Search products" style={{ height: 32, width: 220, border: '1px solid var(--sv-border)', borderRadius: 4, padding: '0 8px' }} /><button type="button" onClick={() => void load(search)} style={{ height: 32, padding: '0 10px', border: '1px solid var(--sv-border)', borderRadius: 4, background: '#fff', fontSize: 11, fontWeight: 700 }}>Search</button></div></div>
          <div style={{ marginTop: 10, border: '1px solid var(--sv-border)', overflowX: 'auto' }}><div style={{ minWidth: 740 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 110px 170px 130px 110px', gap: 10, padding: '8px 10px', background: '#f1f5f9', color: '#475569', fontSize: 11, fontWeight: 750 }}><span>Product</span><span>Candidate</span><span>Matched rule</span><span>Override</span><span>Destination</span></div>
            {loading ? <div style={{ padding: 18, color: 'var(--sv-text-dim)', fontSize: 12 }}>Loading preview...</div> : products.length === 0 ? <div style={{ padding: 18, color: 'var(--sv-text-dim)', fontSize: 12 }}>No products found.</div> : products.map(product => <div key={product.productId} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 110px 170px 130px 110px', gap: 10, alignItems: 'center', padding: '9px 10px', borderTop: '1px solid #eef2f7', fontSize: 12 }}>
              <strong style={{ overflowWrap: 'anywhere' }}>{product.productName}</strong><span>{product.onlineCandidate ? 'Yes' : 'No'}</span><span>{product.matchedRuleName ?? 'Default exclude'}</span><select aria-label={`${product.productName} override`} value={product.overrideMode} onChange={event => void setOverride(product.productId, event.target.value as OverrideMode)} style={{ height: 30, border: '1px solid var(--sv-border)', borderRadius: 4, background: '#fff' }}><option value="automatic">Automatic</option><option value="include">Include</option><option value="exclude">Exclude</option></select><strong style={{ color: product.effectiveDecision === 'include' ? '#166534' : '#64748b' }}>{product.effectiveDecision === 'include' ? 'Include' : 'Exclude'}</strong>
            </div>)}
          </div></div>
        </section>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '12px 22px', borderTop: '1px solid var(--sv-border)', background: '#fff' }}><span style={{ alignSelf: 'center', color: 'var(--sv-text-dim)', fontSize: 11 }}>Applying records intent only. Provider publication remains unchanged.</span><div style={{ display: 'flex', gap: 8 }}><button type="button" onClick={() => void saveRules()} disabled={saving || applying} style={{ minHeight: 36, padding: '0 12px', border: '1px solid var(--sv-border)', borderRadius: 5, background: '#fff', fontSize: 12, fontWeight: 700 }}>{saving ? 'Saving...' : 'Save and preview'}</button><button type="button" onClick={() => void applyAssignments()} disabled={saving || applying} style={{ minHeight: 36, padding: '0 13px', border: 0, borderRadius: 5, background: '#111827', color: '#fff', fontSize: 12, fontWeight: 750 }}>{applying ? 'Applying...' : 'Apply assignments'}</button></div></div>
    </div>
  </div>;
}
