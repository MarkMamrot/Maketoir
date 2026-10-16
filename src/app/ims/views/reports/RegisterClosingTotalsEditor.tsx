import React from 'react';
import type { PosRegisterSession } from './PosRegistersReportView';

export function RegisterClosingTotalsEditor({ session, onClose, onSaved }: {
  session: PosRegisterSession; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [counts, setCounts] = React.useState<Record<number, string>>(() => Object.fromEntries(
    session.reconciliations.map(row => [row.id, row.counted_amount == null ? '' : String(row.counted_amount)]),
  ));
  const [reason, setReason] = React.useState('');
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => { dialogRef.current?.showModal(); }, []);

  function close() {
    if (busy) return;
    dialogRef.current?.close();
    onClose();
  }

  async function save() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/ims/reports/pos-registers/closing', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id, previousFloat: session.opening_float, reason, acknowledgeAccounting: acknowledged,
          entries: session.reconciliations.map(row => ({
            id: row.id, previousCount: row.counted_amount, expectedAmount: row.expected_amount,
            countedAmount: counts[row.id] === '' ? null : counts[row.id],
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Closing count correction failed.');
      setSaved(true);
      await onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Closing count correction failed.');
    } finally {
      setBusy(false);
    }
  }

  const money = (value: number | null) => value == null ? 'Not recorded'
    : value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
  const latest = session.latest_closing_correction;
  return <dialog ref={dialogRef} aria-labelledby="closing-dialog-title"
    onCancel={event => { event.preventDefault(); close(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}
    style={{ width: 520, maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
      boxSizing: 'border-box', border: '1px solid var(--sv-border)', borderRadius: 12, padding: 24,
      background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)' }}>
    <h2 id="closing-dialog-title" style={{ marginTop: 0 }}>Edit closing totals</h2>
    <p>{session.location_name} / {session.register_name} - closed</p>
    <div role="note" style={{ padding: 12, border: '1px solid var(--sv-amber)', borderRadius: 6 }}>
      <strong>Manual accounting correction required</strong>
      <p>Only counted amounts change. Expected takings, opening float and sales stay unchanged. Solvantis variances recalculate, but existing Xero documents, payments, banking snapshots and posting statuses do not change. The bookkeeper must manually review and correct affected accounting entries. No accounting sync or email is triggered.</p>
    </div>
    {latest && <section aria-label="Last closing correction">
      <p>Last correction by {latest.actor_name} ({latest.created_at}). Reason: {latest.reason}</p>
      <ul>{latest.counts_snapshot.map(row => <li key={row.id}>
        {row.payment_method}: {money(row.previous_counted)} to {money(row.counted_amount)}
      </li>)}</ul>
    </section>}
    {!saved && <form onSubmit={event => { event.preventDefault(); void save(); }}>
      {session.reconciliations.map(row => <label key={row.id} style={{ display: 'block', marginTop: 16 }}>
        {row.payment_method} counted ($)
        <input autoFocus={row.id === session.reconciliations[0].id} type="number" step="0.01"
          min={row.payment_method.trim().toLowerCase() === 'cash' ? '0' : '-9999999999.99'} max="9999999999.99"
          required={row.counted_amount !== null} value={counts[row.id]} disabled={busy}
          onChange={event => setCounts(previous => ({ ...previous, [row.id]: event.target.value }))}
          style={{ display: 'block', padding: 8, marginTop: 4 }} />
        <small>Recorded: {money(row.counted_amount)}; expected takings: {money(row.expected_amount)}</small>
      </label>)}
      <p>Cash counted is the physical drawer total including the opening float. Only changed methods lose their old denomination breakdown.</p>
      <label style={{ display: 'block', marginTop: 12 }}>Reason for correction
        <textarea required maxLength={1000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)}
          style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4 }} />
      </label>
      <label style={{ display: 'block', marginTop: 12 }}>
        <input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />
        I understand the bookkeeper must correct affected accounting entries manually.
      </label>
      <button type="submit" disabled={busy || !acknowledged} style={{ marginTop: 12 }}>{busy ? 'Saving...' : 'Save closing totals'}</button>
    </form>}
    {saved && <p role="status">Closing totals corrected. No accounting sync or email was triggered. Notify the bookkeeper to review affected accounting entries.</p>}
    {error && <p role="alert" style={{ color: 'var(--sv-red)' }}>{error}</p>}
    <button type="button" disabled={busy} onClick={close} style={{ marginTop: 16 }}>Close</button>
  </dialog>;
}
