'use client';

import React, { useEffect, useState } from 'react';

type Rule = {
  id: number;
  name: string;
  discount_basis_points: number;
  discount_days: number;
  is_active: number;
  contact_usage_count: number;
  order_usage_count: number;
};

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--sv-etch)',
  background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', fontSize: 13,
};

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json();
  if (!response.ok || payload.success === false) throw new Error(payload.error || 'Request failed.');
  return payload;
}

export function EarlyPaymentDiscountSettingsSection() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ name: '', discountPercent: '', discountDays: '10', isActive: true });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await request('/api/ims/early-payment-discount-rules');
      setRules(Array.isArray(payload.data) ? payload.data : []);
    } catch (loadError: any) {
      setError(loadError.message || 'Rules could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const reset = () => {
    setEditingId(null);
    setDraft({ name: '', discountPercent: '', discountDays: '10', isActive: true });
  };

  const edit = (rule: Rule) => {
    setEditingId(rule.id);
    setDraft({
      name: rule.name,
      discountPercent: String(Number(rule.discount_basis_points) / 100),
      discountDays: String(rule.discount_days),
      isActive: Boolean(rule.is_active),
    });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const body = JSON.stringify({
        name: draft.name,
        discountPercent: Number(draft.discountPercent),
        discountDays: Number(draft.discountDays),
        isActive: draft.isActive,
      });
      await request(editingId ? `/api/ims/early-payment-discount-rules/${editingId}` : '/api/ims/early-payment-discount-rules', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      reset();
      await load();
    } catch (saveError: any) {
      setError(saveError.message || 'Rule could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (rule: Rule) => {
    if (!confirm(`Deactivate "${rule.name}"? Existing order snapshots will remain unchanged.`)) return;
    setError('');
    try {
      await request(`/api/ims/early-payment-discount-rules/${rule.id}`, { method: 'DELETE' });
      if (editingId === rule.id) reset();
      await load();
    } catch (deactivateError: any) {
      setError(deactivateError.message || 'Rule could not be deactivated.');
    }
  };

  return (
    <section style={{ padding: 20, background: 'var(--sv-bg-2)', borderRadius: 8, border: '1px solid var(--sv-etch)', maxWidth: 760, marginBottom: 20 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: 'var(--sv-text-strong)', textTransform: 'uppercase' }}>Early-payment discounts</h3>
      <p style={{ margin: '0 0 16px', fontSize: 12, lineHeight: 1.5, color: 'var(--sv-text-dim)' }}>
        Rules discount merchandise only. Freight is excluded, and the discounted balance must be fully paid by the inclusive cutoff date.
      </p>

      {error && <div role="alert" style={{ marginBottom: 12, color: 'var(--sv-red)', fontSize: 12 }}>{error}</div>}
      {loading ? <div style={{ color: 'var(--sv-text-dim)', fontSize: 13 }}>Loading rules...</div> : (
        <div style={{ marginBottom: 16, borderTop: '1px solid var(--sv-etch)' }}>
          {rules.length === 0 && <div style={{ padding: '12px 0', color: 'var(--sv-text-dim)', fontSize: 13 }}>No rules configured.</div>}
          {rules.map(rule => (
            <div key={rule.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) auto auto', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--sv-etch)', opacity: rule.is_active ? 1 : .6 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sv-text-strong)' }}>{rule.name}</div>
                <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginTop: 2 }}>{Number(rule.discount_basis_points) / 100}% within {rule.discount_days} days · {rule.contact_usage_count} contact defaults · {rule.order_usage_count} orders</div>
              </div>
              <button type="button" onClick={() => edit(rule)} style={{ padding: '6px 10px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', cursor: 'pointer' }}>Edit</button>
              {rule.is_active ? <button type="button" onClick={() => deactivate(rule)} style={{ padding: '6px 10px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'transparent', color: 'var(--sv-red)', cursor: 'pointer' }}>Deactivate</button> : <span style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>Inactive</span>}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 110px 110px', gap: 10, alignItems: 'end' }}>
        <label style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>Rule name<input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="5% within 10 days" style={{ ...fieldStyle, marginTop: 4 }} /></label>
        <label style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>Discount %<input type="number" min="0.01" max="100" step="0.01" value={draft.discountPercent} onChange={event => setDraft(current => ({ ...current, discountPercent: event.target.value }))} style={{ ...fieldStyle, marginTop: 4 }} /></label>
        <label style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>Days<input type="number" min="0" max="3650" step="1" value={draft.discountDays} onChange={event => setDraft(current => ({ ...current, discountDays: event.target.value }))} style={{ ...fieldStyle, marginTop: 4 }} /></label>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, fontSize: 12, color: 'var(--sv-text-main)' }}><input type="checkbox" checked={draft.isActive} onChange={event => setDraft(current => ({ ...current, isActive: event.target.checked }))} /> Active</label>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" onClick={save} disabled={saving || !draft.name.trim() || !draft.discountPercent || draft.discountDays === ''} style={{ padding: '7px 14px', border: 0, borderRadius: 6, background: 'var(--sv-action)', color: '#fff', cursor: 'pointer', opacity: saving ? .6 : 1 }}>{saving ? 'Saving...' : editingId ? 'Save rule' : 'Add rule'}</button>
        {editingId && <button type="button" onClick={reset} style={{ padding: '7px 14px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'transparent', color: 'var(--sv-text-main)', cursor: 'pointer' }}>Cancel</button>}
      </div>
    </section>
  );
}