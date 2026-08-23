'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from '../Storefront.module.css';

interface QuoteLine { variantId: string; quantity: number; availableUnits: number; isAvailable: boolean; productSlug: string;
  name: string; optionLabel: string; image: { url: string; altText: string } | null; unitPriceCents: number; lineTotalCents: number }
interface Quote { lines: QuoteLine[]; subtotalCents: number; canCheckout: boolean }

export function CartPageClient({ storeSlug }: { storeSlug: string }) {
  const key = `solvantis-native-cart:${storeSlug}`; const [quote, setQuote] = useState<Quote | null>(null); const [error, setError] = useState('');
  const money = (cents: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
  const refresh = async (cart?: { lines: Array<{ variantId: string; quantity: number }> }) => {
    let current = cart; if (!current) { try { current = JSON.parse(localStorage.getItem(key) || '{"lines":[]}'); } catch { current = { lines: [] }; } }
    try { const response = await fetch(`/api/shop/${encodeURIComponent(storeSlug)}/cart/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(current) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Cart could not be loaded.'); setQuote(body); setError(''); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Cart could not be loaded.'); }
  };
  useEffect(() => { void refresh(); }, [storeSlug]);
  const update = (variantId: string, quantity: number) => { if (!quote) return; const lines = quote.lines.flatMap(line => line.variantId === variantId
    ? quantity > 0 ? [{ variantId, quantity }] : [] : [{ variantId: line.variantId, quantity: line.quantity }]);
    const cart = { lines }; localStorage.setItem(key, JSON.stringify(cart)); window.dispatchEvent(new CustomEvent('solvantis-cart-change', { detail: { storeSlug } })); void refresh(cart); };
  if (error) return <div className={styles.empty}>{error}</div>;
  if (!quote) return <div className={styles.empty}>Loading cart...</div>;
  return <div className={styles.content}><div className={styles.catalogueHead}><h1>Cart</h1><Link href={`/shop/${storeSlug}/products`}>Continue shopping</Link></div>
    {!quote.lines.length ? <div className={styles.empty}>Your cart is empty.</div> : <div className={styles.cartLayout}><div className={styles.cartLines}>{quote.lines.map(line => <article className={styles.cartLine} key={line.variantId}>
      {line.image ? <img src={line.image.url} alt={line.image.altText || line.name} /> : <div className={styles.cartThumb} />}
      <div><Link href={`/shop/${storeSlug}/products/${line.productSlug}`}><strong>{line.name}</strong></Link>{line.optionLabel && <span>{line.optionLabel}</span>}<span>{money(line.unitPriceCents)}</span>{!line.isAvailable && <em>Only {line.availableUnits} available</em>}</div>
      <input aria-label={`Quantity for ${line.name}`} type="number" min={0} max={Math.max(0, line.availableUnits)} value={line.quantity} onChange={event => update(line.variantId, Math.max(0, Math.floor(Number(event.target.value) || 0)))} />
      <strong>{money(line.lineTotalCents)}</strong><button onClick={() => update(line.variantId, 0)}>Remove</button>
    </article>)}</div><aside className={styles.summary}><div><span>Subtotal</span><strong>{money(quote.subtotalCents)}</strong></div><p>Shipping and discounts are calculated at checkout.</p><button disabled>Checkout setup in progress</button></aside></div>}
  </div>;
}