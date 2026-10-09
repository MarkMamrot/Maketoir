'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface ForeignHint { currency: string; amount: number }
interface RepairMovement {
  id: number; sku: string | null; productName: string; locationName: string; movementType: string;
  referenceType: string; referenceId: number | null; quantity: number; unitCost: number | null;
  costMethod: 'average_cost' | 'fifo'; occurredAt: string;
  suggestions: { costAud: number | null; averageCost: number | null; foreign: ForeignHint[] };
}
interface Selection { value: string; source: 'cost_aud' | 'average_cost' | 'foreign_current_fx' | 'manual'; detail: Record<string, unknown> }

const aud = (value: number) => value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const smallButton: React.CSSProperties = { border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', padding: '6px 8px', fontSize: 11, cursor: 'pointer' };

export function CogsCostRepairPanel({ from, toExclusive, onClose, onSaved }: {
  from: string; toExclusive: string; onClose: () => void; onSaved: (message: string) => void;
}) {
  const [movements, setMovements] = useState<RepairMovement[]>([]);
  const [selections, setSelections] = useState<Record<number, Selection>>({});
  const [rates, setRates] = useState<Record<string, number | null>>({});
  const [reason, setReason] = useState('');
  const [fifoAccepted, setFifoAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    fetch(`/api/ims/cogs/cost-repairs?from=${encodeURIComponent(from)}&toExclusive=${encodeURIComponent(toExclusive)}`, { signal: abort.signal, cache: 'no-store' })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Unknown COGS costs could not be loaded.'); return body.movements as RepairMovement[]; })
      .then(async rows => {
        if (abort.signal.aborted) return;
        setMovements(rows);
        const currencies = [...new Set(rows.flatMap(row => row.suggestions.foreign.map(item => item.currency)))];
        const resolved = await Promise.all(currencies.map(async currency => {
          try {
            const response = await fetch(`/api/ims/exchange-rate?from=${encodeURIComponent(currency)}&to=AUD`, { signal: abort.signal });
            const body = await response.json();
            return [currency, response.ok && body.success && Number(body.rate) > 0 ? Number(body.rate) : null] as const;
          } catch { return [currency, null] as const; }
        }));
        if (!abort.signal.aborted) setRates(Object.fromEntries(resolved));
      })
      .catch(loadError => { if (!abort.signal.aborted) setError(loadError instanceof Error ? loadError.message : 'Unknown COGS costs could not be loaded.'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [from, toExclusive]);

  const choose = (movementId: number, value: number, source: Selection['source'], detail: Record<string, unknown>) => {
    setSelections(current => ({ ...current, [movementId]: { value: String(Math.round(value * 10000) / 10000), source, detail } }));
  };
  const selectedRows = movements.filter(row => selections[row.id] && Number(selections[row.id].value) > 0);
  const selectedFifo = selectedRows.some(row => row.costMethod === 'fifo');

  const save = async () => {
    if (!selectedRows.length || reason.trim().length < 3 || (selectedFifo && !fifoAccepted)) return;
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/ims/cogs/cost-repairs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, toExclusive, repairs: selectedRows.map(row => ({
          movementId: row.id, expectedUnitCost: row.unitCost, newUnitCost: Number(selections[row.id].value),
          source: selections[row.id].source, sourceDetail: selections[row.id].detail, reason: reason.trim(),
          fifoWarningAccepted: row.costMethod === 'fifo' ? fifoAccepted : false,
        })) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'COGS costs could not be saved.');
      onSaved(`${body.repaired} movement ${body.repaired === 1 ? 'cost was' : 'costs were'} repaired. The period COGS has been recalculated.`);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'COGS costs could not be saved.'); }
    finally { setSaving(false); }
  };

  return <div role="dialog" aria-modal="true" aria-label="Fix unknown COGS" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.5)', display: 'grid', placeItems: 'center', padding: 20 }}>
    <section style={{ width: 'min(1120px, 100%)', maxHeight: '90vh', overflow: 'auto', background: 'var(--sv-bg-0)', border: '1px solid var(--sv-etch)', borderRadius: 8, boxShadow: '0 24px 64px rgba(0,0,0,.25)' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)' }}>
        <div><h3 style={{ margin: 0, fontSize: 17, color: 'var(--sv-text-strong)' }}>Fix Unknown COGS</h3><div style={{ marginTop: 3, fontSize: 12, color: 'var(--sv-text-dim)' }}>{from} to {toExclusive} (exclusive)</div></div>
        <button onClick={onClose} aria-label="Close cost repair" title="Close" style={{ ...smallButton, width: 34, height: 34, padding: 0, display: 'grid', placeItems: 'center' }}><X size={16} /></button>
      </header>
      <div style={{ padding: 18 }}>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--sv-text-dim)' }}>All amounts applied to movement COGS are tax-exclusive AUD unit costs. Catalogue and average costs are current hints, not proof of the historical cost. Foreign hints use today&apos;s displayed FX rate and record that rate with the repair.</p>
        {error && <div role="alert" style={{ marginBottom: 12, padding: 10, color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca' }}>{error}</div>}
        {loading ? <div role="status">Loading unknown movement costs...</div> : movements.length === 0 ? <div role="status">No unknown COGS movement costs remain in this period.</div> : <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 930, borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['Movement', 'Product', 'Qty', 'Cost method', 'Choose a tax-exclusive AUD unit cost', 'Reviewed cost'].map(label => <th key={label} style={{ padding: '8px 10px', borderBottom: '1px solid var(--sv-etch)', textAlign: 'left', color: 'var(--sv-text-dim)', fontSize: 11 }}>{label}</th>)}</tr></thead>
            <tbody>{movements.map(row => <tr key={row.id} style={{ borderBottom: '1px solid var(--sv-etch)' }}>
              <td style={{ padding: 10, verticalAlign: 'top' }}>#{row.id}<div style={{ color: 'var(--sv-text-dim)' }}>{new Date(row.occurredAt).toLocaleString('en-AU')}</div><div style={{ color: 'var(--sv-text-dim)' }}>{row.referenceType} {row.referenceId ?? ''}</div></td>
              <td style={{ padding: 10, verticalAlign: 'top' }}>{row.productName}<div style={{ color: 'var(--sv-text-dim)' }}>{row.sku || 'No SKU'} · {row.locationName}</div></td>
              <td style={{ padding: 10, verticalAlign: 'top' }}>{row.quantity.toLocaleString()}</td>
              <td style={{ padding: 10, verticalAlign: 'top' }}>{row.costMethod === 'fifo' ? <strong style={{ color: '#9a3412' }}>FIFO</strong> : 'Average cost'}</td>
              <td style={{ padding: 10, verticalAlign: 'top' }}><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {row.suggestions.costAud != null && <button style={smallButton} onClick={() => choose(row.id, row.suggestions.costAud!, 'cost_aud', { label: 'Current catalogue AUD cost', costAud: row.suggestions.costAud })}>Cost AUD {aud(row.suggestions.costAud)}</button>}
                {row.suggestions.averageCost != null && <button style={smallButton} onClick={() => choose(row.id, row.suggestions.averageCost!, 'average_cost', { label: 'Current average cost', averageCost: row.suggestions.averageCost })}>Average {aud(row.suggestions.averageCost)}</button>}
                {row.suggestions.foreign.map(hint => {
                  const rate = rates[hint.currency]; const converted = rate ? hint.amount * rate : null;
                  return <button key={hint.currency} disabled={!converted} title={converted ? `Current FX: 1 ${hint.currency} = ${rate} AUD` : 'Current AUD conversion is unavailable'} style={{ ...smallButton, cursor: converted ? 'pointer' : 'not-allowed', opacity: converted ? 1 : 0.55 }} onClick={() => converted && choose(row.id, converted, 'foreign_current_fx', { label: 'Current foreign catalogue cost converted at current FX', currency: hint.currency, foreignAmount: hint.amount, audPerForeignUnit: rate })}>{hint.currency} {hint.amount.toLocaleString()} {converted ? `= ${aud(converted)}` : '(FX unavailable)'}</button>;
                })}
              </div></td>
              <td style={{ padding: 10, verticalAlign: 'top' }}><label style={{ display: 'grid', gap: 4 }}><span style={{ color: 'var(--sv-text-dim)' }}>AUD per unit</span><input type="number" min="0.0001" step="0.0001" value={selections[row.id]?.value ?? ''} onChange={event => setSelections(current => ({ ...current, [row.id]: { value: event.target.value, source: 'manual', detail: { label: 'Manual reviewed AUD unit cost' } } }))} style={{ width: 130, padding: '7px 8px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)' }} /></label></td>
            </tr>)}</tbody>
          </table>
        </div>}
        {movements.length > 0 && <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
          <label style={{ display: 'grid', gap: 5, maxWidth: 720 }}><strong style={{ fontSize: 12 }}>Review reason</strong><textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={2} placeholder="What evidence was reviewed, and why is this cost appropriate for these movements?" style={{ padding: 9, border: '1px solid var(--sv-etch)', borderRadius: 6, resize: 'vertical', background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)' }} /></label>
          {selectedFifo && <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', maxWidth: 800, color: '#9a3412', fontSize: 12 }}><input type="checkbox" checked={fifoAccepted} onChange={event => setFifoAccepted(event.target.checked)} /><span>I understand this changes the movement&apos;s COGS unit cost only. Existing FIFO layers and allocations are not rewritten and may retain different historical cost evidence.</span></label>}
          <div><button disabled={saving || selectedRows.length === 0 || reason.trim().length < 3 || (selectedFifo && !fifoAccepted)} onClick={() => void save()} style={{ border: 0, borderRadius: 6, background: 'var(--sv-action)', color: '#fff', padding: '9px 13px', fontSize: 12, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving || selectedRows.length === 0 || reason.trim().length < 3 || (selectedFifo && !fifoAccepted) ? 0.55 : 1 }}>{saving ? 'Saving...' : `Save ${selectedRows.length} reviewed ${selectedRows.length === 1 ? 'cost' : 'costs'}`}</button></div>
        </div>}
      </div>
    </section>
  </div>;
}