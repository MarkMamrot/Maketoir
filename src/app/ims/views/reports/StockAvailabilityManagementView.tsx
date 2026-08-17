'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, RefreshCw, ShieldCheck } from 'lucide-react';
import { ReportScrollTable } from './ReportScrollTable';
import type {
  StockAvailabilityManagementRow,
  StockAvailabilityManagementSummary,
} from '@/lib/ims/stockAvailabilityManagement';

const EMPTY_SUMMARY: StockAvailabilityManagementSummary = {
  unsourcedUnits: 0,
  unsourcedValue: 0,
  readyUnits: 0,
  readyValue: 0,
  protectedIncomingUnits: 0,
  protectedIncomingCost: 0,
  overduePromises: 0,
  atRiskPromises: 0,
};

const cell: React.CSSProperties = { padding: '9px 12px', borderBottom: '1px solid var(--sv-etch)', fontSize: 13 };
const numeric: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const heading: React.CSSProperties = {
  ...cell,
  background: 'var(--sv-bg-2)',
  color: 'var(--sv-text-dim)',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
};

const quantity = (value: number) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
const money = (value: number) => Number(value).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
const date = (value: string | null) => value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU') : '-';

function Metric({
  icon,
  label,
  primary,
  secondary,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  primary: string;
  secondary: string;
  tone: string;
}) {
  return (
    <div style={{ border: '1px solid var(--sv-etch)', borderTop: `3px solid ${tone}`, borderRadius: 8, padding: 16, background: 'var(--sv-bg-1)', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sv-text-dim)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
        <span style={{ color: tone, display: 'flex' }}>{icon}</span>{label}
      </div>
      <div style={{ marginTop: 10, color: 'var(--sv-text-strong)', fontSize: 23, lineHeight: 1.1, fontWeight: 750 }}>{primary}</div>
      <div style={{ marginTop: 5, color: 'var(--sv-text-dim)', fontSize: 12 }}>{secondary}</div>
    </div>
  );
}

export function StockAvailabilityManagementView({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<StockAvailabilityManagementRow[]>([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/ims/reports/stock-availability');
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Failed to load report.');
      setRows(Array.isArray(body.rows) ? body.rows : []);
      setSummary(body.summary ?? EMPTY_SUMMARY);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load report.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const colGroup = () => (
    <colgroup>
      <col style={{ width: 110 }} /><col style={{ width: 180 }} /><col style={{ width: 250 }} />
      <col style={{ width: 150 }} /><col style={{ width: 100 }} /><col style={{ width: 120 }} />
      <col style={{ width: 90 }} /><col style={{ width: 120 }} /><col style={{ width: 110 }} />
      <col style={{ width: 130 }} /><col style={{ width: 120 }} /><col style={{ width: 130 }} />
    </colgroup>
  );

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <button onClick={onBack} title="Back to reports" style={{ border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-1)', color: 'var(--sv-text)', padding: '7px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 12 }}>
            <ArrowLeft size={15} /> Reports
          </button>
          <h1 style={{ margin: 0, color: 'var(--sv-text-strong)', fontSize: 22 }}>Stock Availability</h1>
          <p style={{ margin: '5px 0 0', color: 'var(--sv-text-dim)', fontSize: 13 }}>Open sales demand, protected incoming supply, and customer promise exposure.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} title="Refresh report" style={{ border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-1)', color: 'var(--sv-text)', width: 36, height: 36, borderRadius: 6, display: 'grid', placeItems: 'center', cursor: loading ? 'wait' : 'pointer' }}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Metric icon={<AlertTriangle size={17} />} label="Unsourced" primary={`${quantity(summary.unsourcedUnits)} units`} secondary={`${money(summary.unsourcedValue)} sales value inc tax`} tone="#c2410c" />
        <Metric icon={<CheckCircle2 size={17} />} label="Ready to fulfil" primary={`${quantity(summary.readyUnits)} units`} secondary={`${money(summary.readyValue)} sales value inc tax`} tone="#15803d" />
        <Metric icon={<ShieldCheck size={17} />} label="Protected incoming" primary={`${quantity(summary.protectedIncomingUnits)} units`} secondary={`${money(summary.protectedIncomingCost)} PO cost ex tax, AUD`} tone="#0369a1" />
        <Metric icon={<Clock3 size={17} />} label="Promise exceptions" primary={`${summary.overduePromises} overdue`} secondary={`${summary.atRiskPromises} sales orders at risk`} tone="#b91c1c" />
      </div>

      {error && <div role="alert" style={{ marginBottom: 14, padding: '10px 12px', border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b', borderRadius: 6 }}>{error}</div>}
      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--sv-text-dim)' }}>Loading stock availability...</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', border: '1px solid var(--sv-etch)', color: 'var(--sv-text-dim)' }}>No open stock demand.</div>
      ) : (
        <ReportScrollTable
          ariaLabel="Stock availability management report"
          bodyClassName="stock-availability-report-scroll"
          tableWidth={1620}
          renderColGroup={colGroup}
          frozenColumnWidths={[110, 180]}
          headerRows={<tr><th style={heading}>SO</th><th style={heading}>Customer</th><th style={heading}>Product</th><th style={heading}>Location</th><th style={{ ...heading, textAlign: 'right' }}>Unsourced</th><th style={{ ...heading, textAlign: 'right' }}>Sales value</th><th style={{ ...heading, textAlign: 'right' }}>Ready</th><th style={{ ...heading, textAlign: 'right' }}>Ready value</th><th style={{ ...heading, textAlign: 'right' }}>Incoming</th><th style={{ ...heading, textAlign: 'right' }}>PO cost</th><th style={heading}>Promise</th><th style={heading}>Risk</th></tr>}
        >
          <tbody>
            {rows.map(row => (
              <tr key={row.soItemId}>
                <td style={{ ...cell, fontWeight: 700 }}>{row.soNumber}</td>
                <td style={cell}>{row.customerName}</td>
                <td style={cell}><div style={{ fontWeight: 600 }}>{row.productName}</div><div style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}>{row.sku || 'No SKU'}</div></td>
                <td style={cell}>{row.locationName}</td>
                <td style={numeric}>{quantity(row.unsourced)}</td>
                <td style={numeric}>{money(row.unsourcedValue)}</td>
                <td style={numeric}>{quantity(row.ready)}</td>
                <td style={numeric}>{money(row.readyValue)}</td>
                <td style={numeric}>{quantity(row.protectedIncoming)}</td>
                <td style={numeric}>{money(row.protectedIncomingCost)}</td>
                <td style={cell}>{date(row.promisedDate)}</td>
                <td style={cell}>{row.overdue ? <span style={{ color: '#b91c1c', fontWeight: 700 }}>Overdue</span> : row.atRisk ? <span style={{ color: '#c2410c', fontWeight: 700 }}>At risk</span> : '-'}</td>
              </tr>
            ))}
          </tbody>
        </ReportScrollTable>
      )}
    </div>
  );
}