'use client';

import { PackageSearch, TrendingUp } from 'lucide-react';
import type { DashboardProductInsight } from '@/lib/ims/dashboardProductInsights';

interface DashboardProductInsightsProps {
  top: DashboardProductInsight[];
  slow: DashboardProductInsight[];
  periodLabel: string;
  loading: boolean;
}

function productLabel(product: DashboardProductInsight): string {
  return product.option_label ? `${product.product_name} / ${product.option_label}` : product.product_name;
}

export function DashboardProductInsights({ top, slow, periodLabel, loading }: DashboardProductInsightsProps) {
  const maxTopUnits = Math.max(1, ...top.map(product => Number(product.units_sold ?? 0)));
  const maxSlowStock = Math.max(1, ...slow.map(product => Number(product.stock_on_hand ?? 0)));

  return (
    <section style={{ minWidth: 0, background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--sv-etch)', background: 'color-mix(in srgb, var(--sv-bg-1) 42%, var(--sv-bg-2))' }}>
        <div style={{ marginBottom: 2, color: 'var(--sv-action)', fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }}>Product momentum</div>
        <div style={{ color: 'var(--sv-text-strong)', fontSize: 16, fontWeight: 750 }}>Fast movers and stock at risk - {periodLabel}</div>
      </div>

      {loading ? (
        <div style={{ minHeight: 218, display: 'grid', placeItems: 'center', color: 'var(--sv-text-dim)', fontSize: 12 }}>Loading product insights...</div>
      ) : top.length === 0 && slow.length === 0 ? (
        <div style={{ minHeight: 218, display: 'grid', placeItems: 'center', color: 'var(--sv-text-dim)', fontSize: 12 }}>No product movement data for this period.</div>
      ) : (
        <div className="dashboard-product-insights__grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 218 }}>
          <div style={{ minWidth: 0, padding: '14px 16px', borderRight: '1px solid var(--sv-etch)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12, color: 'var(--sv-mint)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>
              <TrendingUp size={14} /> Top sellers
            </div>
            {top.length === 0 ? (
              <div style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>No products sold.</div>
            ) : top.map((product, index) => {
              const width = Math.max(5, (Number(product.units_sold) / maxTopUnits) * 100);
              return (
                <div key={product.variant_id} style={{ marginBottom: index === top.length - 1 ? 0 : 13 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 22, height: 22, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'color-mix(in srgb, var(--sv-mint) 14%, transparent)', color: 'var(--sv-mint)', fontSize: 10, fontWeight: 850 }}>{index + 1}</span>
                    <div style={{ minWidth: 0 }}>
                      <div title={productLabel(product)} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--sv-text-main)', fontSize: 12, fontWeight: 700 }}>{productLabel(product)}</div>
                      <div style={{ marginTop: 1, color: 'var(--sv-text-dim)', fontSize: 9 }}>{product.sku || 'No SKU'}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: 'var(--sv-text-strong)', fontSize: 12, fontWeight: 800 }}>{Number(product.units_sold).toLocaleString('en-AU')} sold</div>
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

          <div style={{ minWidth: 0, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12, color: 'var(--sv-amber)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>
              <PackageSearch size={14} /> High stock / slow sales
            </div>
            {slow.length === 0 ? (
              <div style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>No stocked slow movers found.</div>
            ) : slow.map((product, index) => {
              const width = Math.max(5, (Number(product.stock_on_hand) / maxSlowStock) * 100);
              return (
                <div key={product.variant_id} style={{ marginBottom: index === slow.length - 1 ? 0 : 13 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div title={productLabel(product)} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--sv-text-main)', fontSize: 12, fontWeight: 700 }}>{productLabel(product)}</div>
                      <div style={{ marginTop: 1, color: 'var(--sv-text-dim)', fontSize: 9 }}>{product.sku || 'No SKU'} · {Number(product.units_sold).toLocaleString('en-AU')} sold</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: 'var(--sv-amber)', fontSize: 12, fontWeight: 850 }}>{Number(product.stock_on_hand).toLocaleString('en-AU')} SOH</div>
                      <div style={{ marginTop: 1, color: 'var(--sv-text-dim)', fontSize: 9 }}>stock exposure</div>
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
        @media (max-width: 720px) {
          .dashboard-product-insights__grid { grid-template-columns: 1fr !important; }
          .dashboard-product-insights__grid > div:first-child { border-right: 0 !important; border-bottom: 1px solid var(--sv-etch); }
        }
      `}</style>
    </section>
  );
}