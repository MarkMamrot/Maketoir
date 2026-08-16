'use client';

import { useEffect, useState } from 'react';

import type {
  DashboardComparisonMode,
  DashboardSalesComparison,
} from '@/lib/ims/dashboardSalesComparison';

type ComparisonResponse = {
  success: boolean;
  comparisons?: Record<DashboardComparisonMode, DashboardSalesComparison[]>;
};

const MODE_LABELS: Record<DashboardComparisonMode, string> = {
  prior_period: 'Prior period',
  year_ago: 'Same period last year',
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateRange(from: string, to: string): string {
  const format = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return from === to ? format(from) : `${format(from)} - ${format(to)}`;
}

export function DashboardSalesComparison() {
  const [mode, setMode] = useState<DashboardComparisonMode>('prior_period');
  const [data, setData] = useState<ComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch('/api/ims/dashboard/sales-comparison')
      .then(response => response.json())
      .then(result => { if (active) setData(result); })
      .catch(() => { if (active) setData({ success: false }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const rows = data?.comparisons?.[mode] ?? [];

  return (
    <section className="dashboard-sales-comparison" style={{ width: '100%', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10, overflow: 'hidden' }}>
      <style>{`
        .dashboard-sales-comparison__head { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:16px 18px; border-bottom:1px solid var(--sv-etch); }
        .dashboard-sales-comparison__row { display:grid; grid-template-columns:88px minmax(210px,.9fr) minmax(240px,1.4fr) minmax(125px,.65fr); align-items:center; gap:18px; min-height:66px; padding:10px 18px; border-top:1px solid var(--sv-etch); }
        .dashboard-sales-comparison__row:first-child { border-top:0; }
        .dashboard-sales-comparison__amounts { display:flex; align-items:baseline; gap:7px; min-width:0; }
        .dashboard-sales-comparison__bar { position:relative; height:24px; display:grid; grid-template-columns:1fr 1fr; }
        .dashboard-sales-comparison__bar::after { content:''; position:absolute; left:50%; top:-4px; bottom:-4px; width:1px; background:var(--sv-text-dim); opacity:.48; }
        @media (max-width: 760px) {
          .dashboard-sales-comparison__head { align-items:flex-start; flex-direction:column; }
          .dashboard-sales-comparison__row { grid-template-columns:72px 1fr auto; gap:8px 12px; padding:12px 14px; }
          .dashboard-sales-comparison__amounts { grid-column:2 / 4; grid-row:2; }
          .dashboard-sales-comparison__bar { grid-column:1 / 4; grid-row:3; margin-top:4px; }
          .dashboard-sales-comparison__change { grid-column:3; grid-row:1; text-align:right !important; }
        }
      `}</style>
      <div className="dashboard-sales-comparison__head">
        <div>
          <h2 style={{ margin: 0, color: 'var(--sv-text-strong)', fontSize: 16, fontWeight: 700 }}>Sales performance</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--sv-text-dim)', fontSize: 12 }}>Rolling sales compared across matched periods</p>
        </div>
        <div role="group" aria-label="Compare sales against" style={{ display: 'flex', alignItems: 'center', gap: 5, padding: 3, border: '1px solid var(--sv-etch)', borderRadius: 7, background: 'var(--sv-bg-1)' }}>
          {(Object.keys(MODE_LABELS) as DashboardComparisonMode[]).map(value => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              style={{ minHeight: 30, padding: '5px 11px', border: 0, borderRadius: 5, background: mode === value ? 'var(--sv-action)' : 'transparent', color: mode === value ? '#fff' : 'var(--sv-text-main)', cursor: 'pointer', fontSize: 12, fontWeight: 650 }}
            >
              {MODE_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sv-text-dim)', fontSize: 13 }}>Loading sales comparisons...</div>
      ) : !data?.success ? (
        <div style={{ padding: 28, textAlign: 'center', color: 'var(--sv-red)', fontSize: 13 }}>Sales comparison is temporarily unavailable.</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: 'var(--sv-text-dim)', fontSize: 13 }}>More sales history is needed for this comparison.</div>
      ) : (
        <div>
          {rows.map(row => {
            const positive = row.change > 0;
            const negative = row.change < 0;
            const color = positive ? 'var(--sv-mint)' : negative ? 'var(--sv-red)' : 'var(--sv-text-dim)';
            const magnitude = row.changePercent == null
              ? (row.current.sales > 0 ? 100 : 0)
              : Math.min(100, Math.abs(row.changePercent));
            const percentLabel = row.changePercent == null
              ? (row.current.sales > 0 ? 'New' : 'No change')
              : `${row.changePercent > 0 ? '+' : ''}${row.changePercent.toFixed(1)}%`;
            const tooltip = `Current: ${formatDateRange(row.current.from, row.current.to)}. ${MODE_LABELS[mode]}: ${formatDateRange(row.comparison.from, row.comparison.to)}.`;

            return (
              <div className="dashboard-sales-comparison__row" key={row.days} title={tooltip}>
                <div style={{ color: 'var(--sv-text-strong)', fontSize: 13, fontWeight: 750 }}>{row.label}</div>
                <div className="dashboard-sales-comparison__amounts">
                  <span style={{ color: 'var(--sv-text-strong)', fontSize: 17, fontWeight: 750, whiteSpace: 'nowrap' }}>{formatCurrency(row.current.sales)}</span>
                  <span style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}>vs</span>
                  <span style={{ color: 'var(--sv-text-dim)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{formatCurrency(row.comparison.sales)}</span>
                </div>
                <div className="dashboard-sales-comparison__bar" aria-label={`${percentLabel} compared with ${MODE_LABELS[mode]}`}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', background: 'color-mix(in srgb, var(--sv-bg-1) 82%, transparent)', borderRadius: '4px 0 0 4px', overflow: 'hidden' }}>
                    {negative && <span style={{ height: 10, width: `${magnitude}%`, minWidth: magnitude > 0 ? 3 : 0, background: color, borderRadius: '4px 0 0 4px' }} />}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', background: 'color-mix(in srgb, var(--sv-bg-1) 82%, transparent)', borderRadius: '0 4px 4px 0', overflow: 'hidden' }}>
                    {(positive || (row.changePercent == null && row.current.sales > 0)) && <span style={{ height: 10, width: `${magnitude}%`, minWidth: magnitude > 0 ? 3 : 0, background: color, borderRadius: '0 4px 4px 0' }} />}
                  </div>
                </div>
                <div className="dashboard-sales-comparison__change" style={{ textAlign: 'right' }}>
                  <div style={{ color, fontSize: 16, fontWeight: 800 }}>{percentLabel}</div>
                  <div style={{ marginTop: 2, color: 'var(--sv-text-dim)', fontSize: 11, whiteSpace: 'nowrap' }}>{row.change > 0 ? '+' : ''}{formatCurrency(row.change)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}