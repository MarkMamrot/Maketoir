import React from 'react';
import type { SalesOrderCogsSummary } from '@/lib/ims/salesOrderCogs';

export interface SalesOrderCogsDisplayLine {
  sku?: string | null;
  qtyFulfilled: number;
  qtyOrdered: number;
  qtyRemaining: number;
  actualCogs: number | null;
  estimatedRemainingCogs: number | null;
  isStockItem: boolean;
}

export function SalesOrderCogsDetail({
  lines,
  summary,
  grossProfit,
  grossMarginPct,
}: {
  lines: SalesOrderCogsDisplayLine[];
  summary: SalesOrderCogsSummary;
  grossProfit: number | null;
  grossMarginPct: number | null;
}) {
  const dim: React.CSSProperties = { color: 'var(--sv-text-dim)', fontSize: 11 };
  const cell: React.CSSProperties = { padding: '3px 8px', fontSize: 11, color: 'var(--sv-text-dim)' };
  const num: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const unresolvedShippedCost = lines.some(line => line.isStockItem && line.qtyFulfilled > 0 && line.actualCogs === null);

  const formatAud = (amount: number) => `$${amount.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <section aria-label="Shipped COGS and gross margin">
      <div style={{ color: 'var(--sv-text-dim)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, marginTop: 8 }}>
        C — Cost Summary
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--sv-etch)' }}>
            <th style={{ ...cell, textAlign: 'left', fontWeight: 600 }}>Product / SKU</th>
            <th style={{ ...num, fontWeight: 600 }}>Shipped / Ordered</th>
            <th style={{ ...num, fontWeight: 600 }}>Actual COGS (AUD)</th>
            <th style={{ ...num, fontWeight: 600 }}>Estimate for Remaining (AUD)</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.sku ?? 'line'}-${index}`} style={{ borderBottom: '1px solid var(--sv-etch)' }}>
              <td style={cell}>{line.sku || '—'}</td>
              <td style={num}>{line.qtyFulfilled} / {line.qtyOrdered}</td>
              <td style={num}>{line.actualCogs === null ? (line.qtyFulfilled > 0 ? 'Unresolved' : '—') : formatAud(line.actualCogs)}</td>
              <td style={num}>{!line.isStockItem || line.qtyRemaining === 0 ? '—' : line.estimatedRemainingCogs !== null ? formatAud(line.estimatedRemainingCogs) : 'Unavailable'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--sv-etch)' }}>
            <td colSpan={2} style={{ ...cell, fontWeight: 700 }}>Totals</td>
            <td style={{ ...num, fontWeight: 700 }}>{summary.actualCogs !== null ? formatAud(summary.actualCogs) : 'Unresolved'}</td>
            <td style={{ ...num, fontWeight: 700 }}>{summary.hasRemainingStock ? (summary.estimatedRemainingCogs !== null ? formatAud(summary.estimatedRemainingCogs) : 'Unavailable') : '—'}</td>
          </tr>
        </tfoot>
      </table>
      <div style={{ ...dim, marginTop: 6 }}>Actual COGS uses captured cost for shipped units. The remaining estimate uses current business-wide Average Cost, falling back to Standard Cost; it is not included in actual COGS or margin.</div>
      {summary.grossMarginAvailable && grossProfit !== null && grossMarginPct !== null ? (
        <div aria-label="Gross profit and margin" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <div style={{ minWidth: 150, padding: '8px 10px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-2)' }}>
            <div style={{ ...dim, textTransform: 'uppercase', fontWeight: 700 }}>Gross Profit</div>
            <strong style={{ color: grossProfit >= 0 ? 'var(--sv-mint,#0c9)' : 'var(--sv-red)', fontSize: 13 }}>{formatAud(grossProfit)}</strong>
          </div>
          <div style={{ minWidth: 150, padding: '8px 10px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-2)' }}>
            <div style={{ ...dim, textTransform: 'uppercase', fontWeight: 700 }}>Gross Margin</div>
            <strong style={{ color: grossMarginPct >= 0 ? 'var(--sv-mint,#0c9)' : 'var(--sv-red)', fontSize: 13 }}>{grossMarginPct.toFixed(1)}%</strong>
          </div>
        </div>
      ) : (
        <div role="status" style={{ ...dim, marginTop: 8, padding: '7px 9px', border: '1px solid var(--sv-etch)', borderRadius: 6, color: unresolvedShippedCost ? 'var(--sv-amber,#f59e0b)' : 'var(--sv-text-dim)' }}>
          {unresolvedShippedCost
            ? 'Gross margin unavailable: one or more shipped stock lines have unresolved cost.'
            : 'Gross margin available after all units ship with captured cost.'}
        </div>
      )}
    </section>
  );
}