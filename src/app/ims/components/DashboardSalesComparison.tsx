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
    <section className="dashboard-sales-comparison" style={{ width: '100%', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 8, overflow: 'hidden' }}>
      <style>{`
        .dashboard-sales-comparison__head { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:18px 20px; border-bottom:1px solid var(--sv-etch); background:color-mix(in srgb, var(--sv-bg-1) 42%, var(--sv-bg-2)); }
        .dashboard-sales-comparison__kicker { margin:0 0 4px; color:var(--sv-action); font-size:10px; font-weight:800; letter-spacing:0; text-transform:uppercase; }
        .dashboard-sales-comparison__modes { display:flex; align-items:center; gap:3px; padding:3px; border:1px solid var(--sv-etch); border-radius:7px; background:var(--sv-bg-2); }
        .dashboard-sales-comparison__mode { min-height:32px; padding:5px 12px; border:0; border-radius:5px; cursor:pointer; font-size:12px; font-weight:700; transition:background-color .15s, color .15s, box-shadow .15s; }
        .dashboard-sales-comparison__columns, .dashboard-sales-comparison__row { display:grid; grid-template-columns:104px minmax(210px,.9fr) minmax(240px,1.4fr) minmax(125px,.65fr); align-items:center; gap:18px; }
        .dashboard-sales-comparison__columns { padding:8px 20px; color:var(--sv-text-dim); font-size:9px; font-weight:800; letter-spacing:0; text-transform:uppercase; background:color-mix(in srgb, var(--sv-bg-1) 68%, transparent); }
        .dashboard-sales-comparison__columns span:last-child { text-align:right; }
        .dashboard-sales-comparison__row { min-height:72px; padding:11px 20px; border-top:1px solid var(--sv-etch); transition:background-color .15s; }
        .dashboard-sales-comparison__row:hover { background:color-mix(in srgb, var(--sv-action) 3%, transparent); }
        .dashboard-sales-comparison__period { display:inline-flex; width:max-content; align-items:center; min-height:27px; padding:0 9px; border:1px solid var(--sv-etch); border-radius:5px; background:var(--sv-bg-1); color:var(--sv-text-strong); font-size:12px; font-weight:800; }
        .dashboard-sales-comparison__amounts { display:flex; flex-direction:column; align-items:flex-start; gap:2px; min-width:0; }
        .dashboard-sales-comparison__bar { position:relative; height:28px; display:grid; grid-template-columns:1fr 1fr; }
        .dashboard-sales-comparison__bar::after { content:''; position:absolute; left:50%; top:-3px; bottom:-3px; width:1px; background:var(--sv-text-dim); opacity:.52; }
        .dashboard-sales-comparison__change { justify-self:end; min-width:104px; padding:6px 9px; border-radius:6px; text-align:right; }
        @media (max-width: 760px) {
          .dashboard-sales-comparison__head { align-items:flex-start; flex-direction:column; }
          .dashboard-sales-comparison__modes { width:100%; }
          .dashboard-sales-comparison__mode { flex:1; }
          .dashboard-sales-comparison__columns { display:none; }
          .dashboard-sales-comparison__row { grid-template-columns:72px 1fr auto; gap:8px 12px; padding:14px; }
          .dashboard-sales-comparison__amounts { grid-column:2 / 4; grid-row:2; }
          .dashboard-sales-comparison__bar { grid-column:1 / 4; grid-row:3; margin-top:4px; }
          .dashboard-sales-comparison__change { grid-column:3; grid-row:1; min-width:0; }
        }
      `}</style>
      <div className="dashboard-sales-comparison__head">
        <div>
          <p className="dashboard-sales-comparison__kicker">Revenue trend</p>
          <h2 style={{ margin: 0, color: 'var(--sv-text-strong)', fontSize: 18, fontWeight: 750 }}>Sales performance</h2>
          <p style={{ margin: '5px 0 0', color: 'var(--sv-text-dim)', fontSize: 12 }}>Rolling sales across equivalent trading periods</p>
        </div>
        <div className="dashboard-sales-comparison__modes" role="group" aria-label="Compare sales against">
          {(Object.keys(MODE_LABELS) as DashboardComparisonMode[]).map(value => (
            <button
              key={value}
              className="dashboard-sales-comparison__mode"
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              style={{ background: mode === value ? 'var(--sv-action)' : 'transparent', color: mode === value ? '#fff' : 'var(--sv-text-main)', boxShadow: mode === value ? '0 1px 3px rgba(15,23,42,.16)' : 'none' }}
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
          <div className="dashboard-sales-comparison__columns" aria-hidden="true">
            <span>Window</span>
            <span>Revenue</span>
            <span>Movement</span>
            <span>Variance</span>
          </div>
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
                <div className="dashboard-sales-comparison__period">{row.label}</div>
                <div className="dashboard-sales-comparison__amounts">
                  <span style={{ color: 'var(--sv-text-strong)', fontSize: 17, fontWeight: 800, whiteSpace: 'nowrap' }}>{formatCurrency(row.current.sales)}</span>
                  <span style={{ color: 'var(--sv-text-dim)', fontSize: 11, whiteSpace: 'nowrap' }}>compared with <strong style={{ color: 'var(--sv-text-main)', fontWeight: 650 }}>{formatCurrency(row.comparison.sales)}</strong></span>
                </div>
                <div className="dashboard-sales-comparison__bar" aria-label={`${percentLabel} compared with ${MODE_LABELS[mode]}`}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', background: 'color-mix(in srgb, var(--sv-bg-1) 82%, transparent)', borderRadius: '4px 0 0 4px', overflow: 'hidden' }}>
                    {negative && <span style={{ height: 10, width: `${magnitude}%`, minWidth: magnitude > 0 ? 3 : 0, background: color, borderRadius: '4px 0 0 4px' }} />}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', background: 'color-mix(in srgb, var(--sv-bg-1) 82%, transparent)', borderRadius: '0 4px 4px 0', overflow: 'hidden' }}>
                    {(positive || (row.changePercent == null && row.current.sales > 0)) && <span style={{ height: 10, width: `${magnitude}%`, minWidth: magnitude > 0 ? 3 : 0, background: color, borderRadius: '0 4px 4px 0' }} />}
                  </div>
                </div>
                <div className="dashboard-sales-comparison__change" style={{ background: `color-mix(in srgb, ${color} 9%, transparent)` }}>
                  <div style={{ color, fontSize: 15, fontWeight: 850 }}>{percentLabel}</div>
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