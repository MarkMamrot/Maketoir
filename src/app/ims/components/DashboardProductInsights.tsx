'use client';

import { useState } from 'react';
import { PackageSearch, TrendingUp } from 'lucide-react';
import type { DashboardProductInsight } from '@/lib/ims/dashboardProductInsights';

interface DashboardProductInsightsProps {
  top: DashboardProductInsight[];
  slow: DashboardProductInsight[];
  valueTop: DashboardProductInsight[];
  valueSlow: DashboardProductInsight[];
  periodLabel: string;
  loading: boolean;
}

function productLabel(product: DashboardProductInsight): string {
  return product.option_label ? `${product.product_name} / ${product.option_label}` : product.product_name;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(value);
}

export function DashboardProductInsights({ top, slow, valueTop, valueSlow, periodLabel, loading }: DashboardProductInsightsProps) {
  const [mode, setMode] = useState<'qty' | 'value'>('value');
  const activeTop = mode === 'value' ? valueTop : top;
  const activeSlow = mode === 'value' ? valueSlow : slow;
  const topMetric = (product: DashboardProductInsight) => mode === 'value' ? Number(product.revenue ?? 0) : Number(product.units_sold ?? 0);
  const slowMetric = (product: DashboardProductInsight) => mode === 'value' ? Number(product.stock_value ?? 0) : Number(product.stock_on_hand ?? 0);
  const maxTopMetric = Math.max(1, ...activeTop.map(topMetric));
  const maxSlowMetric = Math.max(1, ...activeSlow.map(slowMetric));

  return (
    <section style={{ minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 8, overflow: 'hidden' }}>
      <div className="dashboard-product-insights__head" style={{ padding: '13px 16px', borderBottom: '1px solid var(--sv-etch)', background: 'color-mix(in srgb, var(--sv-bg-1) 42%, var(--sv-bg-2))' }}>
        <div>
          <div style={{ marginBottom: 2, color: 'var(--sv-action)', fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }}>Product momentum</div>
          <div style={{ color: 'var(--sv-text-strong)', fontSize: 16, fontWeight: 750 }}>Fast movers and stock at risk - {periodLabel}</div>
        </div>
        <div className="dashboard-product-insights__modes" role="group" aria-label="Rank product momentum by">
          {(['qty', 'value'] as const).map(value => (
            <button key={value} type="button" onClick={() => setMode(value)} aria-pressed={mode === value} className="dashboard-product-insights__mode" style={{ background: mode === value ? 'var(--sv-action)' : 'transparent', color: mode === value ? '#fff' : 'var(--sv-text-main)', boxShadow: mode === value ? '0 1px 3px rgba(15,23,42,.16)' : 'none' }}>
              By {value === 'qty' ? 'Qty' : 'Value'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ minHeight: 218, display: 'grid', placeItems: 'center', color: 'var(--sv-text-dim)', fontSize: 12 }}>Loading product insights...</div>
      ) : activeTop.length === 0 && activeSlow.length === 0 ? (
        <div style={{ minHeight: 218, display: 'grid', placeItems: 'center', color: 'var(--sv-text-dim)', fontSize: 12 }}>No product movement data for this period.</div>
      ) : (
        <div className="dashboard-product-insights__grid" style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 218 }}>
          <div style={{ minWidth: 0, padding: '14px 16px', borderRight: '1px solid var(--sv-etch)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12, color: 'var(--sv-mint)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>
              <TrendingUp size={14} /> Top sellers
            </div>
            {activeTop.length === 0 ? (
              <div style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>No products sold.</div>
            ) : activeTop.map((product, index) => {
              const width = Math.max(5, (topMetric(product) / maxTopMetric) * 100);
              return (
                <div key={product.variant_id} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', marginBottom: index === activeTop.length - 1 ? 0 : 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 22, height: 22, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'color-mix(in srgb, var(--sv-mint) 14%, transparent)', color: 'var(--sv-mint)', fontSize: 10, fontWeight: 850 }}>{index + 1}</span>
                    <div style={{ minWidth: 0 }}>
                      <div title={productLabel(product)} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--sv-text-main)', fontSize: 12, fontWeight: 700 }}>{productLabel(product)}</div>
                      <div style={{ marginTop: 1, color: 'var(--sv-text-dim)', fontSize: 9 }}>{product.sku || 'No SKU'}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: 'var(--sv-text-strong)', fontSize: 12, fontWeight: 800 }}>{mode === 'value' ? formatCurrency(Number(product.revenue)) : `${Number(product.units_sold).toLocaleString('en-AU')} sold`}</div>
                      <div style={{ marginTop: 1, color: 'var(--sv-text-dim)', fontSize: 9 }}>{Number(product.stock_on_hand).toLocaleString('en-AU')} on hand</div>
                    </div>
                  </div>
                  <div style={{ height: 5, margin: '6px 0 0 30px', borderRadius: 3, background: 'var(--sv-bg-1)', overflow: 'hidden' }}>
                    <div style={{ width: `${width}%`, height: '100%', borderRadius: 3, background: 'var(--sv-mint)' }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ minWidth: 0, padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12, color: 'var(--sv-amber)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>
              <PackageSearch size={14} /> High stock / slow sales
            </div>
            {activeSlow.length === 0 ? (
              <div style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>No stocked slow movers found.</div>
            ) : activeSlow.map((product, index) => {
              const width = Math.max(5, (slowMetric(product) / maxSlowMetric) * 100);
              return (
                <div key={product.variant_id} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', marginBottom: index === activeSlow.length - 1 ? 0 : 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div title={productLabel(product)} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--sv-text-main)', fontSize: 12, fontWeight: 700 }}>{productLabel(product)}</div>
                      <div style={{ marginTop: 1, color: 'var(--sv-text-dim)', fontSize: 9 }}>{product.sku || 'No SKU'} · {Number(product.units_sold).toLocaleString('en-AU')} sold</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: 'var(--sv-amber)', fontSize: 12, fontWeight: 850 }}>{mode === 'value' ? formatCurrency(Number(product.stock_value)) : `${Number(product.stock_on_hand).toLocaleString('en-AU')} SOH`}</div>
                      <div style={{ marginTop: 1, color: 'var(--sv-text-dim)', fontSize: 9 }}>{mode === 'value' ? 'stock value' : 'stock exposure'}</div>
                    </div>
                  </div>
                  <div style={{ height: 5, marginTop: 6, borderRadius: 3, background: 'var(--sv-bg-1)', overflow: 'hidden' }}>
                    <div style={{ width: `${width}%`, height: '100%', borderRadius: 3, background: 'var(--sv-amber)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <style>{`
        .dashboard-product-insights__head { display:flex; align-items:center; justify-content:space-between; gap:16px; }
        .dashboard-product-insights__modes { display:flex; align-items:center; gap:3px; padding:3px; border:1px solid var(--sv-etch); border-radius:7px; background:var(--sv-bg-2); }
        .dashboard-product-insights__mode { min-height:28px; padding:4px 10px; border:0; border-radius:5px; cursor:pointer; font-size:11px; font-weight:700; transition:background-color .15s, color .15s, box-shadow .15s; }
        @media (max-width: 720px) {
          .dashboard-product-insights__head { align-items:flex-start; flex-direction:column; }
          .dashboard-product-insights__modes { width:100%; }
          .dashboard-product-insights__mode { flex:1; }
          .dashboard-product-insights__grid { grid-template-columns: 1fr !important; }
          .dashboard-product-insights__grid > div:first-child { border-right: 0 !important; border-bottom: 1px solid var(--sv-etch); }
        }
      `}</style>
    </section>
  );
}