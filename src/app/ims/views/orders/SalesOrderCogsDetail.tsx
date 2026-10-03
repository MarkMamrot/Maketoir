import React from 'react';
import type { SalesOrderCogsSummary } from '@/lib/ims/salesOrderCogs';

export interface SalesOrderCogsDisplayLine {
  sku?: string | null;
  qtyFulfilled: number;
  qtyRemaining: number;
  actualCogs: number | null;
  estimatedRemainingCogs: number | null;
  revenue: number;
  marginPct: number | null;
  isStockItem: boolean;
}

export function SalesOrderCogsDetail({
  lines,
  summary,
  revenue,
  currency,
  grossProfit,
  grossMarginPct,
}: {
  lines: SalesOrderCogsDisplayLine[];
  summary: SalesOrderCogsSummary;
  revenue: number;
  currency: string;
  grossProfit: number | null;
  grossMarginPct: number | null;
}) {
  const dim: React.CSSProperties = { color: 'var(--sv-text-dim)', fontSize: 11 };
  const cell: React.CSSProperties = { padding: '3px 8px', fontSize: 11, color: 'var(--sv-text-dim)' };
  const num: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const unresolvedShippedCost = lines.some(line => line.isStockItem && line.qtyFulfilled > 0 && line.actualCogs === null);

  const formatAud = (amount: number) => `$${amount.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatRevenue = (amount: number) => currency === 'AUD'
    ? formatAud(amount)
    : `${currency} ${amount.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <section aria-label="Shipped COGS and gross margin">
      <div style={{ color: 'var(--sv-text-dim)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4, marginTop: 8 }}>
        C — Shipped COGS &amp; Gross Margin
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--sv-etch)' }}>
            <th style={{ ...cell, textAlign: 'left', fontWeight: 600 }}>SKU</th>
            <th style={{ ...num, fontWeight: 600 }}>Shipped</th>
            <th style={{ ...num, fontWeight: 600 }}>Remaining</th>
            <th style={{ ...num, fontWeight: 600 }}>Actual COGS (AUD)</th>
            <th style={{ ...num, fontWeight: 600 }}>Estimate (AUD)</th>
            <th style={{ ...num, fontWeight: 600 }}>Revenue ({currency})</th>
            <th style={{ ...num, fontWeight: 600 }}>Margin</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.sku ?? 'line'}-${index}`} style={{ borderBottom: '1px solid var(--sv-etch)' }}>
              <td style={cell}>{line.sku || '—'}</td>
              <td style={num}>{line.qtyFulfilled}</td>
              <td style={num}>{line.qtyRemaining}</td>
              <td style={num}>{line.actualCogs === null ? (line.qtyFulfilled > 0 ? 'Unresolved' : '—') : formatAud(line.actualCogs)}</td>
              <td style={num}>{!line.isStockItem || line.qtyRemaining === 0 ? '—' : line.estimatedRemainingCogs !== null ? formatAud(line.estimatedRemainingCogs) : 'Unavailable'}</td>
              <td style={{ ...num, color: 'var(--sv-text-main)' }}>{formatRevenue(line.revenue)}</td>
              <td style={{ ...num, color: line.marginPct !== null && line.marginPct >= 0 ? 'var(--sv-mint,#0c9)' : 'var(--sv-red)' }}>
                {line.marginPct !== null ? `${line.marginPct.toFixed(1)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--sv-etch)' }}>
            <td colSpan={3} style={{ ...cell, fontWeight: 700 }}>Actual totals</td>
            <td style={{ ...num, fontWeight: 700 }}>{summary.actualCogs !== null ? formatAud(summary.actualCogs) : 'Unresolved'}</td>
            <td style={{ ...num, fontWeight: 700 }}>{summary.hasRemainingStock ? (summary.estimatedRemainingCogs !== null ? formatAud(summary.estimatedRemainingCogs) : 'Unavailable') : '—'}</td>
            <td style={{ ...num, fontWeight: 700 }}>{formatRevenue(revenue)}</td>
            <td style={{ ...num, fontWeight: 700, color: grossMarginPct !== null && grossMarginPct >= 0 ? 'var(--sv-mint,#0c9)' : 'var(--sv-red)' }}>
              {grossMarginPct !== null ? `${grossMarginPct.toFixed(1)}%` : '—'}
            </td>
          </tr>
          <tr>
            <td colSpan={5} style={dim}>Gross Profit = Revenue − actual shipped COGS; only shown after all units ship with captured cost.</td>
            <td colSpan={2} style={{ ...dim, textAlign: 'right', fontWeight: 700, color: grossProfit !== null && grossProfit >= 0 ? 'var(--sv-mint,#0c9)' : 'var(--sv-red)' }}>
              {grossProfit !== null ? formatAud(grossProfit) : '—'}
            </td>
          </tr>
        </tfoot>
      </table>
      <div style={{ ...dim, marginTop: 3 }}>Actual COGS uses captured cost for shipped units only. Estimates for remaining units use current business-wide Average Cost, falling back to Standard Cost. Estimates are not actual COGS or included in margin.</div>
      {unresolvedShippedCost && (
        <div style={{ ...dim, marginTop: 3, color: 'var(--sv-amber,#f59e0b)' }}>Some shipped stock has no positive cost captured; actual COGS and gross margin are unresolved.</div>
      )}
    </section>
  );
}