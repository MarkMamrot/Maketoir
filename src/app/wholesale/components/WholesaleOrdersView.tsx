'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, FileDown, FilePenLine, MapPin, PackageCheck, PackageOpen, RefreshCw, Trash2, X } from 'lucide-react';
import styles from './WholesaleOrdersView.module.css';

type OrderFilter = 'all' | 'open' | 'draft' | 'completed';

interface PortalOrder {
  kind: 'draft' | 'sales_order';
  id: number;
  reference: string;
  status: string;
  total_amount: number;
  item_count: number;
  total_units: number;
  fulfilled_units?: number;
  order_date?: string | null;
  expected_date?: string | null;
  updated_at: string;
  wholesale_location_id?: number;
  location_name?: string;
}

export interface WholesaleOrderLine {
  id: number;
  variant_id: string;
  product_name: string;
  variant_label: string | null;
  sku: string | null;
  qty_ordered: number;
  qty_fulfilled: number;
  unit_price: number;
  line_total: number;
}

interface OrderDetail extends PortalOrder {
  so_number: string;
  subtotal: number;
  tax_amount: number;
  currency_code: string;
  fulfilled_date: string | null;
  payment_terms: string | null;
  created_at: string;
  items: WholesaleOrderLine[];
}

const completedStatuses = new Set(['fulfilled', 'cancelled']);

function formatCurrency(value: number, currency = 'AUD') {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(Number(value));
}

function formatDate(value?: string | null) {
  if (!value) return 'Not set';
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function orderMatchesFilter(order: PortalOrder, filter: OrderFilter) {
  if (filter === 'all') return true;
  if (filter === 'draft') return order.kind === 'draft';
  if (filter === 'completed') return order.kind === 'sales_order' && completedStatuses.has(order.status);
  return order.kind === 'sales_order' && !completedStatuses.has(order.status);
}

export function WholesaleOrdersView({
  activeDraftId,
  cartItemCount,
  onContinueDraft,
  onLoadDraft,
  currentLocationId,
  onSwitchLocation,
  onReorder,
}: {
  activeDraftId: number | null;
  cartItemCount: number;
  onContinueDraft: () => void;
  onLoadDraft: (id: number) => void;
  currentLocationId: number;
  onSwitchLocation: (locationId: number) => void;
  onReorder: (items: WholesaleOrderLine[]) => void;
}) {
  const [orders, setOrders] = useState<PortalOrder[]>([]);
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [pendingLoadDraft, setPendingLoadDraft] = useState<number | null>(null);
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmReplaceCart, setConfirmReplaceCart] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/wholesale/orders');
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Orders could not be loaded.');
      setOrders(body.orders ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Orders could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openDetail = async (order: PortalOrder) => {
    if (order.kind !== 'sales_order') return;
    setDetailLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/wholesale/sales-orders/${order.id}`);
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Order details could not be loaded.');
      setSelected({ ...order, ...body.order });
      setConfirmReplaceCart(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Order details could not be loaded.');
    } finally {
      setDetailLoading(false);
    }
  };

  const deleteDraft = async (id: number) => {
    setDeleting(id);
    try {
      const response = await fetch(`/api/wholesale/orders/${id}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Draft could not be deleted.');
      setPendingDelete(null);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Draft could not be deleted.');
    } finally {
      setDeleting(null);
    }
  };

  const counts = {
    all: orders.length,
    open: orders.filter(order => orderMatchesFilter(order, 'open')).length,
    draft: orders.filter(order => orderMatchesFilter(order, 'draft')).length,
    completed: orders.filter(order => orderMatchesFilter(order, 'completed')).length,
  };
  const visibleOrders = orders.filter(order => orderMatchesFilter(order, filter));

  const editDraft = (id: number) => {
    if (activeDraftId === id) {
      onContinueDraft();
      return;
    }
    if (cartItemCount > 0 && pendingLoadDraft !== id) {
      setPendingLoadDraft(id);
      setPendingDelete(null);
      return;
    }
    onLoadDraft(id);
  };

  const reorderSelected = () => {
    if (!selected) return;
    if (cartItemCount > 0 && !confirmReplaceCart) {
      setConfirmReplaceCart(true);
      return;
    }
    onReorder(selected.items);
  };

  return (
    <section className={styles.workspace}>
      <header className={styles.heading}>
        <div>
          <p>Order history</p>
          <h1>Orders</h1>
          <span>Track drafts, submitted orders and fulfilment progress.</span>
        </div>
        <div className={styles.totalMetric}>
          <PackageOpen size={18} aria-hidden="true" />
          <div><strong>{orders.length}</strong><span>Total orders</span></div>
        </div>
      </header>

      <div className={styles.filters} role="tablist" aria-label="Order status">
        {(['all', 'open', 'draft', 'completed'] as const).map(option => (
          <button
            key={option}
            role="tab"
            aria-selected={filter === option}
            className={filter === option ? styles.filterActive : ''}
            onClick={() => setFilter(option)}
          >
            {statusLabel(option)} <span>{counts[option]}</span>
          </button>
        ))}
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {loading ? (
        <div className={styles.empty}>Loading orders...</div>
      ) : visibleOrders.length === 0 ? (
        <div className={styles.empty}>
          <PackageCheck size={28} aria-hidden="true" />
          <strong>No {filter === 'all' ? '' : `${filter} `}orders</strong>
          <span>Orders matching this view will appear here.</span>
        </div>
      ) : (
        <div className={styles.orderList}>
          {visibleOrders.map(order => {
            const units = Number(order.total_units ?? 0);
            const fulfilled = Number(order.fulfilled_units ?? 0);
            const progress = units > 0 ? Math.min(100, (fulfilled / units) * 100) : 0;
            return (
              <article className={styles.orderRow} key={`${order.kind}-${order.id}`}>
                <div className={styles.orderIdentity}>
                  <span className={`${styles.status} ${styles[`status_${order.status}`] ?? ''}`}>{statusLabel(order.status)}</span>
                  <strong>{order.reference}</strong>
                  <small><CalendarDays size={13} /> {formatDate(order.order_date ?? order.updated_at)}{order.location_name ? ` · ${order.location_name}` : ''}</small>
                </div>
                <div className={styles.orderMeasure}>
                  <span>{Number(order.item_count)} lines</span>
                  <strong>{units} units</strong>
                </div>
                <div className={styles.orderValue}>
                  <span>Order total</span>
                  <strong>{formatCurrency(order.total_amount)}</strong>
                </div>
                {order.kind === 'sales_order' && (
                  <div className={styles.progress}>
                    <span><span>Fulfilled</span><strong>{fulfilled} / {units}</strong></span>
                    <div><i style={{ width: `${progress}%` }} /></div>
                  </div>
                )}
                <div className={styles.actions}>
                  {order.kind === 'draft' ? (
                    <>
                      {pendingLoadDraft === order.id ? (
                        <div className={styles.inlineConfirm} role="alert">
                          <span>Replace current cart?</span>
                          <button className={styles.cancelAction} onClick={() => setPendingLoadDraft(null)}>Keep cart</button>
                          <button className={styles.primaryAction} onClick={() => editDraft(order.id)}>Replace</button>
                        </div>
                      ) : pendingDelete === order.id ? (
                        <div className={styles.inlineConfirm} role="alert">
                          <span>Delete this draft?</span>
                          <button className={styles.cancelAction} onClick={() => setPendingDelete(null)}>Cancel</button>
                          <button className={styles.dangerAction} onClick={() => void deleteDraft(order.id)} disabled={deleting === order.id}><Trash2 size={14} /> Delete</button>
                        </div>
                      ) : (
                        <>
                          {order.wholesale_location_id && order.wholesale_location_id !== currentLocationId ? (
                            <button className={styles.primaryAction} onClick={() => onSwitchLocation(order.wholesale_location_id!)}><MapPin size={15} /> Switch to edit</button>
                          ) : <button className={styles.primaryAction} onClick={() => editDraft(order.id)}><FilePenLine size={15} /> {activeDraftId === order.id ? 'Continue' : 'Edit'}</button>}
                          <button className={styles.iconAction} onClick={() => { setPendingDelete(order.id); setPendingLoadDraft(null); }} disabled={deleting === order.id} aria-label={`Delete ${order.reference}`} title="Delete draft"><Trash2 size={16} /></button>
                        </>
                      )}
                    </>
                  ) : (
                    <button className={styles.detailAction} onClick={() => void openDetail(order)} disabled={detailLoading}>
                      View <ArrowRight size={15} />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selected && (
        <div className={styles.detailLayer} role="dialog" aria-modal="true" aria-labelledby="wholesale-order-title">
          <button className={styles.backdrop} onClick={() => setSelected(null)} aria-label="Close order details" />
          <aside className={styles.detailPanel}>
            <header className={styles.detailHeader}>
              <div>
                <span className={`${styles.status} ${styles[`status_${selected.status}`] ?? ''}`}>{statusLabel(selected.status)}</span>
                <h2 id="wholesale-order-title">{selected.so_number}</h2>
                <p>Placed {formatDate(selected.order_date)}{selected.location_name ? ` · ${selected.location_name}` : ''}</p>
              </div>
              <button className={styles.iconAction} onClick={() => { setSelected(null); setConfirmReplaceCart(false); }} aria-label="Close order details" title="Close"><X size={18} /></button>
            </header>

            <div className={styles.detailDates}>
              <div><span>Expected</span><strong>{formatDate(selected.expected_date)}</strong></div>
              <div><span>Fulfilled</span><strong>{formatDate(selected.fulfilled_date)}</strong></div>
              <div><span>Payment terms</span><strong>{selected.payment_terms || 'Not set'}</strong></div>
            </div>

            <div className={styles.lines}>
              <h3>Order lines</h3>
              {selected.items.map(line => (
                <div className={styles.line} key={line.id}>
                  <div>
                    <strong>{line.product_name}</strong>
                    <span>{[line.variant_label, line.sku].filter(Boolean).join(' | ') || 'Standard'}</span>
                  </div>
                  <div><span>Ordered</span><strong>{Number(line.qty_ordered)}</strong></div>
                  <div><span>Fulfilled</span><strong>{Number(line.qty_fulfilled)}</strong></div>
                  <div><span>Total</span><strong>{formatCurrency(line.line_total, selected.currency_code)}</strong></div>
                </div>
              ))}
            </div>

            <footer className={styles.totals}>
              <div><span>Subtotal</span><strong>{formatCurrency(selected.subtotal, selected.currency_code)}</strong></div>
              <div><span>Tax</span><strong>{formatCurrency(selected.tax_amount, selected.currency_code)}</strong></div>
              <div className={styles.grandTotal}><span>Total</span><strong>{formatCurrency(selected.total_amount, selected.currency_code)}</strong></div>
              <div className={styles.documents}>
                <span>Documents</span>
                <div>
                  <a href={`/api/wholesale/sales-orders/${selected.id}/pdf?document=sales-order`} target="_blank" rel="noreferrer"><FileDown size={15} /> Sales order</a>
                  {selected.status === 'fulfilled' ? (
                    <a href={`/api/wholesale/sales-orders/${selected.id}/pdf?document=tax-invoice`} target="_blank" rel="noreferrer"><FileDown size={15} /> Tax invoice</a>
                  ) : selected.status !== 'cancelled' ? (
                    <a href={`/api/wholesale/sales-orders/${selected.id}/pdf?document=pro-forma`} target="_blank" rel="noreferrer"><FileDown size={15} /> Pro forma</a>
                  ) : null}
                </div>
              </div>
              {confirmReplaceCart && (
                <div className={styles.replaceNotice} role="alert">
                  Your current cart has {cartItemCount} line{cartItemCount === 1 ? '' : 's'}. Ordering again will replace it.
                </div>
              )}
              <div className={styles.detailActions}>
                {confirmReplaceCart && <button className={styles.cancelAction} onClick={() => setConfirmReplaceCart(false)}>Keep current cart</button>}
                <button className={styles.primaryAction} onClick={reorderSelected}><RefreshCw size={15} /> {confirmReplaceCart ? 'Replace cart' : 'Order again'}</button>
              </div>
            </footer>
          </aside>
        </div>
      )}
    </section>
  );
}