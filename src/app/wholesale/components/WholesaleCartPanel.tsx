'use client';

import { useState } from 'react';
import { ArrowLeft, Check, FileText, MapPin, Minus, PackageCheck, Plus, Save, Send, ShoppingCart, Trash2, X } from 'lucide-react';
import type { WholesaleAccountProfile, WholesaleAddress } from '@/lib/wholesale/wholesaleAccountProfile';
import styles from './WholesaleCartPanel.module.css';

export interface WholesaleCartItem {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_label: string;
  sku: string | null;
  qty: number;
  unit_price: number;
  available: number;
  allow_indent: boolean;
  is_indent: boolean;
  indent_qty: number;
}

type CartStep = 'cart' | 'review' | 'complete';

function currency(value: number) {
  return value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

function addressLines(address?: WholesaleAddress) {
  if (!address) return ['Address unavailable'];
  return [
    address.address,
    address.address2,
    [address.suburb, address.city].filter(Boolean).join(', '),
    [address.state, address.postcode].filter(Boolean).join(' '),
    address.country,
  ].filter(Boolean) as string[];
}

export function WholesaleCartPanel({
  items,
  notes,
  profile,
  profileError,
  saving,
  onNotesChange,
  onQtyChange,
  onRemove,
  onSaveDraft,
  onSubmit,
  onClose,
  onViewOrders,
  isTestCheckout = false,
}: {
  items: WholesaleCartItem[];
  notes: string;
  profile: WholesaleAccountProfile | null;
  profileError: string;
  saving: boolean;
  onNotesChange: (value: string) => void;
  onQtyChange: (variantId: string, quantity: number) => void;
  onRemove: (variantId: string) => void;
  onSaveDraft: () => void;
  onSubmit: () => Promise<string | null>;
  onClose: () => void;
  onViewOrders: () => void;
  isTestCheckout?: boolean;
}) {
  const [step, setStep] = useState<CartStep>('cart');
  const [submittedNumber, setSubmittedNumber] = useState('');
  const subtotal = items.reduce((sum, item) => sum + item.qty * item.unit_price, 0);
  const totalUnits = items.reduce((sum, item) => sum + item.qty, 0);
  const indentUnits = items.reduce((sum, item) => sum + Number(item.indent_qty || 0), 0);

  const submit = async () => {
    const soNumber = await onSubmit();
    if (!soNumber) return;
    setSubmittedNumber(soNumber);
    setStep('complete');
  };

  return (
    <div className={styles.layer} role="dialog" aria-modal="true" aria-labelledby="cart-panel-title">
      <button className={styles.backdrop} onClick={onClose} aria-label="Close cart" />
      <aside className={styles.panel}>
        <header className={styles.header}>
          <div>
            <span>{step === 'cart' ? 'Current order' : step === 'review' ? 'Final check' : isTestCheckout ? 'Test Draft created' : 'Order received'}</span>
            <h2 id="cart-panel-title">
              {step === 'cart' ? 'Cart' : step === 'review' ? 'Review order' : submittedNumber}
            </h2>
          </div>
          <button className={styles.iconButton} onClick={onClose} aria-label="Close cart" title="Close"><X size={18} /></button>
        </header>

        {step === 'complete' ? (
          <div className={styles.complete}>
            <div className={styles.completeIcon}><PackageCheck size={28} /></div>
            <p>{isTestCheckout ? 'Created in IMS for staff inspection.' : `Submitted to ${profile?.company.name || 'your supplier'} for review.`}</p>
            <h3>{isTestCheckout ? 'Test Draft created.' : 'Your order has been received.'}</h3>
            <span>{isTestCheckout ? 'This order is marked TEST, cannot be confirmed, and must be deleted manually in IMS after testing.' : 'The order now appears in Orders, where you can follow its fulfilment progress.'}</span>
            <div className={styles.completeLocation}><MapPin size={16} /><div><span>Deliver to</span><strong>{profile?.location.name || 'Assigned buying location'}</strong></div></div>
          </div>
        ) : (
          <div className={styles.body}>
            {step === 'cart' ? (
              <>
                {items.length === 0 ? (
                  <div className={styles.empty}><ShoppingCart size={30} /><strong>Your cart is empty</strong></div>
                ) : items.map(item => (
                  <div className={styles.item} key={item.variant_id}>
                    <div className={styles.itemInfo}>
                      <strong>{item.product_name}</strong>
                      <span>{[item.variant_label, item.sku].filter(Boolean).join(' | ') || 'Standard'}</span>
                      {item.indent_qty > 0 && <small>{item.indent_qty} on indent</small>}
                      <div>{currency(item.unit_price)} each</div>
                    </div>
                    <div className={styles.itemControls}>
                      <button className={styles.removeButton} onClick={() => onRemove(item.variant_id)} aria-label={`Remove ${item.product_name}`} title="Remove"><Trash2 size={15} /></button>
                      <div className={styles.quantity}>
                        <button onClick={() => onQtyChange(item.variant_id, Math.max(1, item.qty - 1))} aria-label={`Decrease ${item.product_name}`}><Minus size={14} /></button>
                        <input aria-label={`${item.product_name} quantity`} type="number" min={1} max={item.allow_indent ? undefined : (item.available || undefined)} value={item.qty} onChange={event => {
                          const quantity = Math.max(1, Number.parseInt(event.target.value, 10) || 1);
                          onQtyChange(item.variant_id, item.allow_indent ? quantity : Math.min(quantity, item.available));
                        }} />
                        <button onClick={() => onQtyChange(item.variant_id, item.allow_indent ? item.qty + 1 : Math.min(item.qty + 1, item.available))} aria-label={`Increase ${item.product_name}`}><Plus size={14} /></button>
                      </div>
                      <strong>{currency(item.qty * item.unit_price)}</strong>
                    </div>
                  </div>
                ))}
                <label className={styles.notes}>
                  <span><FileText size={14} /> Order notes</span>
                  <textarea value={notes} onChange={event => onNotesChange(event.target.value)} rows={3} maxLength={2000} placeholder="Delivery instructions or purchase reference" />
                </label>
              </>
            ) : (
              <>
                <section className={styles.reviewSection}>
                  <h3>Order summary</h3>
                  <div className={styles.reviewMetrics}>
                    <div><span>Products</span><strong>{items.length}</strong></div>
                    <div><span>Total units</span><strong>{totalUnits}</strong></div>
                    <div><span>Order total</span><strong>{currency(subtotal)}</strong></div>
                  </div>
                  {indentUnits > 0 && <div className={styles.indentNotice}>{indentUnits} unit{indentUnits === 1 ? '' : 's'} will be sourced on indent.</div>}
                </section>
                <section className={styles.reviewSection}>
                  <div className={styles.reviewHeading}><MapPin size={17} /><h3>Delivery</h3></div>
                  <strong>{profile?.location.name || 'Assigned buying location'}</strong>
                  {addressLines(profile?.location.shippingAddress).map((line, index) => <span className={styles.addressLine} key={`${line}-${index}`}>{line}</span>)}
                  {!profile && <div className={styles.profileNotice}>{profileError || 'Loading assigned account and delivery details...'}</div>}
                </section>
                <section className={styles.reviewSection}>
                  <h3>Commercial terms</h3>
                  <div className={styles.termRow}><span>Payment terms</span><strong>{profile?.company.paymentTerms || 'To be confirmed'}</strong></div>
                  <div className={styles.termRow}><span>Notes</span><strong>{notes || 'None'}</strong></div>
                </section>
                {isTestCheckout && <section className={styles.reviewSection}><h3>Test checkout</h3><span>This creates a real Draft Sales Order in IMS marked TEST. It will not notify the buyer or supplier, commit stock, sync to integrations, or enter sales reporting. Delete it manually in IMS when testing is complete.</span></section>}
              </>
            )}
          </div>
        )}

        <footer className={styles.footer}>
          {step === 'cart' ? (
            <>
              <div className={styles.total}><span>Subtotal</span><strong>{currency(subtotal)}</strong></div>
              <div className={styles.actions}>
                <button className={styles.secondaryButton} onClick={onSaveDraft} disabled={!items.length || saving}><Save size={15} /> Save draft</button>
                <button className={styles.primaryButton} onClick={() => setStep('review')} disabled={!items.length || saving}>Review order <Send size={15} /></button>
              </div>
            </>
          ) : step === 'review' ? (
            <div className={styles.actions}>
              <button className={styles.secondaryButton} onClick={() => setStep('cart')} disabled={saving}><ArrowLeft size={15} /> Back</button>
              <button className={styles.primaryButton} onClick={() => void submit()} disabled={saving || !profile}><Check size={15} /> {saving ? 'Submitting...' : isTestCheckout ? 'Create test Draft in IMS' : 'Place order'}</button>
            </div>
          ) : (
            <div className={styles.actions}>
              <button className={styles.secondaryButton} onClick={onClose}>Close</button>
              <button className={styles.primaryButton} onClick={onViewOrders}>View orders <ArrowLeft className={styles.forwardArrow} size={15} /></button>
            </div>
          )}
        </footer>
      </aside>
    </div>
  );
}