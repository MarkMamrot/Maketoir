'use client';

import { useState } from 'react';
import type { StorefrontProductProjection } from '@/lib/storefront/commerce';
import styles from '../Storefront.module.css';

export function ProductPurchase({ storeSlug, product }: { storeSlug: string; product: StorefrontProductProjection }) {
  const [variantId, setVariantId] = useState(product.variants[0]?.variantId ?? ''); const [quantity, setQuantity] = useState(1); const [notice, setNotice] = useState('');
  const variant = product.variants.find(item => item.variantId === variantId) ?? product.variants[0];
  const money = (amount: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount);
  const add = () => {
    if (!variant || quantity < 1 || (variant.tracksInventory && quantity > variant.availableUnits)) return;
    const key = `solvantis-native-cart:${storeSlug}`; let cart: { lines?: Array<{ variantId: string; quantity: number }> } = {};
    try { cart = JSON.parse(localStorage.getItem(key) || '{}'); } catch { cart = {}; }
    const lines = Array.isArray(cart.lines) ? [...cart.lines] : []; const index = lines.findIndex(line => line.variantId === variant.variantId);
    const requestedQuantity = (index >= 0 ? Number(lines[index].quantity) || 0 : 0) + quantity;
    const nextQuantity = variant.tracksInventory ? Math.min(variant.availableUnits, requestedQuantity) : requestedQuantity;
    if (index >= 0) lines[index] = { variantId: variant.variantId, quantity: nextQuantity }; else lines.push({ variantId: variant.variantId, quantity: nextQuantity });
    localStorage.setItem(key, JSON.stringify({ lines })); window.dispatchEvent(new CustomEvent('solvantis-cart-change', { detail: { storeSlug } }));
    setNotice(`${quantity} ${quantity === 1 ? 'unit' : 'units'} added to cart.`);
  };
  if (!variant) return null;
  return <div className={styles.purchase}>{product.brand && <div className={styles.brandLabel}>{product.brand}</div>}<h1>{product.name}</h1>
    <div className={styles.price}>{money(variant.price.amount)}{variant.compareAtPrice && <del>{money(variant.compareAtPrice.amount)}</del>}</div>
    {product.variants.length > 1 && <label>Option<select value={variant.variantId} onChange={event => { setVariantId(event.target.value); setQuantity(1); setNotice(''); }}>{product.variants.map(item => <option key={item.variantId} value={item.variantId}>{item.optionValues.join(' / ') || item.sku || 'Standard'}</option>)}</select></label>}
    <label>Quantity<input type="number" min={1} max={variant.tracksInventory ? Math.max(1, variant.availableUnits) : undefined} value={quantity} onChange={event => setQuantity(Math.max(1, Math.floor(Number(event.target.value) || 1)))} /></label>
    <button onClick={add} disabled={variant.tracksInventory && (variant.availableUnits < 1 || quantity > variant.availableUnits)}>{variant.tracksInventory && variant.availableUnits < 1 ? 'Sold out' : 'Add to cart'}</button>
    <div className={styles.stock}>{!variant.tracksInventory ? 'Inventory not tracked' : variant.availableUnits > 0 ? `${variant.availableUnits} units available` : 'Currently unavailable'}</div>{notice && <div className={styles.notice} role="status">{notice}</div>}
    {product.descriptionHtml && <div className={styles.description} dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} />}
  </div>;
}