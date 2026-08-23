'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import styles from '../Storefront.module.css';

interface Pickup { locationId: number; label: string; instructions: string | null }
interface Delivery { ruleId: number; label: string; amountCents: number }
interface Options { pickup: Pickup[]; delivery: { options: Delivery[] } | null; subtotalCents: number }

export function CheckoutPageClient({ storeSlug }: { storeSlug: string }) {
  const cartKey = `solvantis-native-cart:${storeSlug}`;
  const [cart, setCart] = useState<{ lines: Array<{ variantId: string; quantity: number }> }>({ lines: [] });
  const [options, setOptions] = useState<Options | null>(null); const [mode, setMode] = useState<'delivery' | 'pickup'>('delivery');
  const [email, setEmail] = useState(''); const [selectedId, setSelectedId] = useState('');
  const [address, setAddress] = useState({ address: '', address2: '', suburb: '', state: '', postcode: '', country: 'Australia' });
  const [working, setWorking] = useState(''); const [error, setError] = useState(''); const [checkout, setCheckout] = useState<any>(null);
  const money = (cents: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
  const requestOptions = async (nextCart: typeof cart, includeAddress = false) => {
    setWorking('options'); setError('');
    try {
      const response = await fetch(`/api/shop/${encodeURIComponent(storeSlug)}/shipping/options`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart: nextCart, address: includeAddress ? address : undefined }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Shipping options could not be loaded.');
      setOptions(body); if (includeAddress) setSelectedId(body.delivery?.options?.[0]?.ruleId ? String(body.delivery.options[0].ruleId) : '');
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Shipping options could not be loaded.'); }
    finally { setWorking(''); }
  };
  useEffect(() => {
    let stored = { lines: [] as Array<{ variantId: string; quantity: number }> };
    try { stored = JSON.parse(localStorage.getItem(cartKey) || '{"lines":[]}'); } catch {}
    setCart(stored); void requestOptions(stored);
  }, [storeSlug]);
  const quoteDelivery = (event: FormEvent) => { event.preventDefault(); void requestOptions(cart, true); };
  const reserve = async () => {
    setWorking('checkout'); setError('');
    try {
      const response = await fetch(`/api/shop/${encodeURIComponent(storeSlug)}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'pickup' ? { fulfilmentType: 'pickup', guestEmail: email, pickupLocationId: Number(selectedId), cart }
          : { fulfilmentType: 'delivery', guestEmail: email, shippingRuleId: Number(selectedId), shippingAddress: address, cart }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Checkout could not be created.'); setCheckout(body.checkout);
    } catch (checkoutError) { setError(checkoutError instanceof Error ? checkoutError.message : 'Checkout could not be created.'); }
    finally { setWorking(''); }
  };
  if (!cart.lines.length) return <div className={styles.empty}>Your cart is empty. <Link href={`/shop/${storeSlug}/products`}>Browse products</Link></div>;
  if (checkout) return <div className={`${styles.content} ${styles.checkoutNarrow}`}><div className={styles.checkoutComplete}><span>Stock reserved</span><h1>Complete payment</h1><p>Your items are reserved until {new Date(checkout.expiresAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}.</p><div><span>Total</span><strong>{money(checkout.totalCents)}</strong></div><button disabled>Secure payment setup in progress</button></div></div>;
  const visibleOptions = mode === 'pickup' ? options?.pickup ?? [] : options?.delivery?.options ?? [];
  return <div className={`${styles.content} ${styles.checkoutNarrow}`}><div className={styles.catalogueHead}><h1>Checkout</h1><Link href={`/shop/${storeSlug}/cart`}>Back to cart</Link></div>
    {error && <div className={styles.checkoutError} role="alert">{error}</div>}
    <div className={styles.checkoutGrid}><section className={styles.checkoutForm}><label>Email<input type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <div className={styles.fulfilmentToggle}><button data-active={mode === 'delivery' || undefined} onClick={() => { setMode('delivery'); setSelectedId(''); }}>Delivery</button><button data-active={mode === 'pickup' || undefined} onClick={() => { setMode('pickup'); setSelectedId(''); }}>Click and collect</button></div>
      {mode === 'delivery' ? <form onSubmit={quoteDelivery}><label>Address<input required value={address.address} onChange={event => setAddress({ ...address, address: event.target.value })} /></label><label>Address line 2<input value={address.address2} onChange={event => setAddress({ ...address, address2: event.target.value })} /></label><div className={styles.addressGrid}><label>Suburb<input required value={address.suburb} onChange={event => setAddress({ ...address, suburb: event.target.value })} /></label><label>State<select required value={address.state} onChange={event => setAddress({ ...address, state: event.target.value })}><option value="">Choose</option>{['ACT','NSW','NT','QLD','SA','TAS','VIC','WA'].map(state => <option key={state}>{state}</option>)}</select></label><label>Postcode<input required inputMode="numeric" maxLength={4} value={address.postcode} onChange={event => setAddress({ ...address, postcode: event.target.value })} /></label></div><button disabled={Boolean(working)}>{working === 'options' ? 'Checking...' : 'Check delivery options'}</button></form> : null}
      <div className={styles.shippingOptions}>{visibleOptions.map(option => { const id = 'locationId' in option ? option.locationId : option.ruleId; const amount = 'amountCents' in option ? option.amountCents : 0; return <label key={id}><input type="radio" name="shipping" value={id} checked={selectedId === String(id)} onChange={event => setSelectedId(event.target.value)} /><span><strong>{option.label}</strong>{'instructions' in option && option.instructions && <small>{option.instructions}</small>}</span><b>{amount ? money(amount) : 'Free'}</b></label>; })}{options && !visibleOptions.length && <p>No {mode === 'delivery' ? 'delivery rates cover this address' : 'pickup locations are available'}.</p>}</div>
    </section><aside className={styles.summary}><div><span>Subtotal</span><strong>{money(options?.subtotalCents ?? 0)}</strong></div>{mode === 'delivery' && selectedId && <div><span>Shipping</span><strong>{money((visibleOptions.find(option => 'ruleId' in option && String(option.ruleId) === selectedId) as Delivery | undefined)?.amountCents ?? 0)}</strong></div>}<button disabled={!email || !selectedId || Boolean(working)} onClick={reserve}>{working === 'checkout' ? 'Reserving...' : 'Continue to payment'}</button></aside></div>
  </div>;
}