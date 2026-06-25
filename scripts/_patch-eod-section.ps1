
$path = "src\app\pos\page.tsx"
$text = [System.IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false))

$startMarker = "const [open, setOpen]         = useState(false);"
$s = $text.IndexOf($startMarker)
if ($s -lt 0) { Write-Error "Start marker not found"; exit 1 }

# End is the "}" that closes EodAccountingSection, just before "// --- Reports Screen" comment
$endMarker = "// "
$e = $text.IndexOf($endMarker, $s + 5000)  # skip past function body
if ($e -lt 0) { Write-Error "End marker not found"; exit 1 }
# Walk back past newlines to find the "}" on its own line
while ($e -gt $s -and $text[$e] -ne "`n") { $e-- }
# Now $e is at the start of the newline before "// ─── Reports Screen..."
# We want to include the closing "}\n\n" in our replacement
$closeIdx = $text.LastIndexOf("}", $e)
$e = $closeIdx + 1  # replace up to and including the closing }

$newBody = @'
const [open, setOpen]           = useState(false);
  const [syncing, setSyncing]     = useState(false);
  const [syncError, setSyncError] = useState('');

  // Standard tax rate from actual sales data (e.g. 0.10 for 10% GST), fallback to 10%
  const effectiveTaxRate = dayTotals && dayTotals.total_exc_tax > 0
    ? dayTotals.tax_total / dayTotals.total_exc_tax
    : 0.10;

  const rows = methods.map(m => {
    const e         = entries[m] ?? {} as EodEntryState;
    const counted   = parseFloat(e.counted ?? '') || 0;
    const openFloat = m === 'Cash' ? (parseFloat(e.openingFloat ?? '') || defaultFloat) : 0;
    const salesAmt  = m === 'Cash' ? counted - openFloat : counted;
    const exp       = expected[m] ?? 0;
    const variance  = salesAmt - exp;
    const synced    = xeroInvoiceIds[m] ?? null;
    const taxExc    = salesAmt / (1 + effectiveTaxRate);
    const gst       = salesAmt - taxExc;
    const taxInc    = salesAmt;
    return { method: m, salesAmt, exp, variance, synced, taxExc, gst, taxInc };
  });

  const totals    = rows.reduce((acc, r) => ({ sales: acc.sales + r.salesAmt, exp: acc.exp + r.exp }), { sales: 0, exp: 0 });
  const allSynced = rows.length > 0 && rows.every(r => r.synced);
  const anySynced = rows.some(r => r.synced);

  function fmtDate(iso?: string) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso.slice(0, 16).replace('T', ' '); }
  }

  async function syncToXero() {
    setSyncing(true);
    setSyncError('');
    try {
      const res  = await fetch('/api/pos/xero/sync-eod', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ locationId: session.location_id, date }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Sync failed.');
      onSynced(data.results ?? []);
    } catch (e: any) {
      setSyncError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  const thA: React.CSSProperties = { textAlign: 'left',  padding: '4px 8px', fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' };
  const tdA: React.CSSProperties = { padding: '7px 8px', fontSize: '.85rem', borderBottom: '1px solid var(--sv-etch)' };

  return (
    <div style={{ marginTop: '1.5rem', border: '1px solid var(--sv-etch)', borderRadius: 10, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', cursor: 'pointer', background: 'var(--sv-bg-2)', userSelect: 'none' }}>
        <span style={{ fontSize: '.88rem', fontWeight: 700, color: 'var(--sv-text-strong)' }}>🏦 Accounting</span>
        <div style={{ flex: 1 }} />
        {allSynced && <span style={{ fontSize: '.75rem', color: 'var(--sv-mint)', fontWeight: 600 }}>✓ Synced to Xero</span>}
        {anySynced && !allSynced && <span style={{ fontSize: '.75rem', color: 'var(--sv-amber)', fontWeight: 600 }}>⚠ Partially synced</span>}
        <span style={{ color: 'var(--sv-text-dim)', fontSize: 13 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '1rem 1.25rem', background: 'var(--sv-bg-1)' }}>
          {/* Summary table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.25rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--sv-etch)' }}>
                <th style={thA}>Method</th>
                <th style={{ ...thA, textAlign: 'right' }}>Ex-Tax</th>
                <th style={{ ...thA, textAlign: 'right' }}>GST</th>
                <th style={{ ...thA, textAlign: 'right' }}>Total (inc tax)</th>
                <th style={{ ...thA, textAlign: 'right' }}>POS Expected</th>
                <th style={{ ...thA, textAlign: 'right' }}>Variance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.method}>
                  <td style={{ ...tdA, fontWeight: 600 }}>{r.method}</td>
                  <td style={{ ...tdA, textAlign: 'right', fontWeight: 600 }}>${fmt(r.taxExc)}</td>
                  <td style={{ ...tdA, textAlign: 'right', color: 'var(--sv-text-dim)' }}>${fmt(r.gst)}</td>
                  <td style={{ ...tdA, textAlign: 'right' }}>${fmt(r.taxInc)}</td>
                  <td style={{ ...tdA, textAlign: 'right', color: 'var(--sv-text-dim)' }}>${fmt(r.exp)}</td>
                  <td style={{ ...tdA, textAlign: 'right', fontWeight: 600, color: r.variance >= 0 ? 'var(--sv-mint)' : 'var(--sv-red)' }}>
                    {r.variance >= 0 ? '+' : ''}{fmt(r.variance)}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--sv-etch)', fontWeight: 700, background: 'var(--sv-bg-0)' }}>
                <td style={{ ...tdA, borderBottom: 'none' }}>Total</td>
                <td style={{ ...tdA, textAlign: 'right', color: 'var(--sv-action)', borderBottom: 'none' }}>
                  ${fmt(dayTotals ? dayTotals.total_exc_tax : totals.sales / (1 + effectiveTaxRate))}
                </td>
                <td style={{ ...tdA, textAlign: 'right', color: 'var(--sv-action)', borderBottom: 'none' }}>
                  ${fmt(dayTotals ? dayTotals.tax_total : totals.sales - totals.sales / (1 + effectiveTaxRate))}
                </td>
                <td style={{ ...tdA, textAlign: 'right', color: 'var(--sv-action)', borderBottom: 'none' }}>
                  ${fmt(dayTotals ? dayTotals.total_inc_tax : totals.sales)}
                </td>
                <td style={{ ...tdA, borderBottom: 'none' }} />
                <td style={{ ...tdA, borderBottom: 'none' }} />
              </tr>
            </tbody>
          </table>

          {/* Per-method Xero entries */}
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
              Xero Entries
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rows.map(r => (
                <div key={r.method} style={{
                  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
                  padding: '10px 14px', borderRadius: 8,
                  border: `1px solid ${r.synced ? 'rgba(16,185,129,.25)' : 'var(--sv-etch)'}`,
                  background: r.synced ? 'rgba(16,185,129,.04)' : 'var(--sv-bg-0)',
                }}>
                  <span style={{ minWidth: 64, fontWeight: 700, fontSize: '.88rem' }}>{r.method}</span>
                  {r.synced ? (
                    <>
                      <span style={{ fontSize: '.75rem', fontWeight: 700, color: '#34d399', background: 'rgba(16,185,129,.13)', borderRadius: 99, padding: '2px 9px', whiteSpace: 'nowrap' }}>
                        ✓ Synced to Xero
                      </span>
                      {r.synced.number ? (
                        <a href={`https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${r.synced.id}`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ color: '#34d399', fontSize: '.82rem', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                          {r.synced.number} ↗
                        </a>
                      ) : (
                        <a href={`https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${r.synced.id}`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ color: '#34d399', fontSize: '.78rem', textDecoration: 'none', opacity: .8 }}>
                          View ↗
                        </a>
                      )}
                      {r.synced.syncedAt && (
                        <span style={{ fontSize: '.75rem', color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>
                          {fmtDate(r.synced.syncedAt)}
                        </span>
                      )}
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, fontSize: '.82rem', flexWrap: 'wrap' }}>
                        <span>
                          <span style={{ color: 'var(--sv-text-dim)' }}>POS Expected: </span>
                          <strong>${fmt(r.exp)}</strong>
                        </span>
                        <span>
                          <span style={{ color: 'var(--sv-text-dim)' }}>Sent to Xero: </span>
                          <strong style={{ color: '#34d399' }}>${fmt(r.taxInc)}</strong>
                        </span>
                        {Math.abs(r.taxInc - r.exp) > 0.005 && (
                          <span style={{ color: '#f87171', fontWeight: 700, fontSize: '.78rem' }}>
                            ⚠ Mismatch: {r.taxInc > r.exp ? '+' : ''}{fmt(r.taxInc - r.exp)}
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: '.75rem', color: 'var(--sv-text-dim)', background: 'var(--sv-bg-2)', borderRadius: 99, padding: '2px 9px', border: '1px solid var(--sv-etch)', whiteSpace: 'nowrap' }}>
                        ○ Not synced
                      </span>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, fontSize: '.82rem', flexWrap: 'wrap' }}>
                        <span>
                          <span style={{ color: 'var(--sv-text-dim)' }}>POS Expected: </span>
                          <strong>${fmt(r.exp)}</strong>
                        </span>
                        <span>
                          <span style={{ color: 'var(--sv-text-dim)' }}>Would send: </span>
                          <strong>${fmt(r.taxInc)}</strong>
                        </span>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {syncError && <div style={{ color: 'var(--sv-red)', fontSize: '.8rem', marginBottom: '.75rem' }}>{syncError}</div>}

          <button onClick={syncToXero} disabled={syncing}
            style={{ ...primaryBtn, padding: '.5rem 1.5rem', fontSize: '.85rem' }}>
            {syncing ? 'Syncing…' : allSynced ? 'Re-sync to Xero' : 'Sync to Xero'}
          </button>
        </div>
      )}
    </div>
  );
}
'@

$before = $text.Substring(0, $s)
$after  = $text.Substring($e)

$newText = $before + $newBody + $after
[System.IO.File]::WriteAllText($path, $newText, [System.Text.UTF8Encoding]::new($false))

$lines = [System.IO.File]::ReadAllLines($path, [System.Text.UTF8Encoding]::new($false))
Write-Host "Done. Total lines: $($lines.Length)"
