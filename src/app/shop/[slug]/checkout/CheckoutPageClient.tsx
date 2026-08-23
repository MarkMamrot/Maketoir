'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';

import styles from '../Storefront.module.css';

interface Pickup { locationId: number; label: string; instructions: string | null }
interface Delivery { ruleId: number; label: string; amountCents: number }
interface Options { pickup: Pickup[]; delivery: { options: Delivery[] } | null; subtotalCents: number }
interface ValueQuote {
  grossTotalCents: number; availableLoyaltyPoints: number; availableStoreCreditCents: number;
  loyaltyCents: number; storeCreditCents: number; payableCents: number;
  rewards: Array<{ id: number; name: string; description: string | null; pointsCost: number; valueCents: number; eligible: boolean }>;
}

function StripePaymentForm({ storeSlug, checkoutId }: { storeSlug: string; checkoutId: string }) {
  const stripe = useStripe(); const elements = useElements(); const [working, setWorking] = useState(false); const [error, setError] = useState('');
  const pay = async (event: FormEvent) => {
    event.preventDefault(); if (!stripe || !elements) return; setWorking(true); setError('');
    const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${window.location.origin}/shop/${storeSlug}/checkout/complete?checkoutId=${checkoutId}` }, redirect: 'if_required' });
    if (result.error) { setError(result.error.message || 'Payment could not be completed.'); setWorking(false); return; }
    window.location.assign(`/shop/${storeSlug}/checkout/complete?checkoutId=${checkoutId}`);
  };
  return <form className={styles.paymentForm} onSubmit={pay}><PaymentElement />{error && <div className={styles.checkoutError}>{error}</div>}<button disabled={!stripe || working}>{working ? 'Processing...' : 'Pay securely'}</button></form>;
}

export function CheckoutPageClient({ storeSlug }: { storeSlug: string }) {
  const cartKey = `solvantis-native-cart:${storeSlug}`;
  const [cart, setCart] = useState<{ lines: Array<{ variantId: string; quantity: number }> }>({ lines: [] });
  const [options, setOptions] = useState<Options | null>(null); const [mode, setMode] = useState<'delivery' | 'pickup'>('delivery');
  const [email, setEmail] = useState(''); const [selectedId, setSelectedId] = useState('');
  const [address, setAddress] = useState({ address: '', address2: '', suburb: '', state: '', postcode: '', country: 'Australia' });
  const [working, setWorking] = useState(''); const [error, setError] = useState(''); const [checkout, setCheckout] = useState<any>(null);
  const [payment, setPayment] = useState<{ clientSecret: string; stripe: Promise<Stripe | null> } | null>(null);
  const [valueQuote, setValueQuote] = useState<ValueQuote | null>(null); const [valueChecked, setValueChecked] = useState(false);
  const [rewardId, setRewardId] = useState(''); const [storeCredit, setStoreCredit] = useState('0');
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
  const startPayment = async (checkoutId: string) => {
    setWorking('payment'); setError('');
    const paymentResponse = await fetch(`/api/shop/${encodeURIComponent(storeSlug)}/checkout/${checkoutId}/payment`, { method: 'POST' });
    const paymentBody = await paymentResponse.json(); if (!paymentResponse.ok) throw new Error(paymentBody.error || 'Payment could not be started.');
    if (paymentBody.payment.completed) {
      window.location.assign(`/shop/${storeSlug}/checkout/complete?checkoutId=${checkoutId}`);
      return;
    }
    if (!paymentBody.payment.clientSecret || !paymentBody.payment.publishableKey || !paymentBody.payment.stripeAccountId) {
      throw new Error('Secure payment details were incomplete.');
    }
    setPayment({ clientSecret: paymentBody.payment.clientSecret,
      stripe: loadStripe(paymentBody.payment.publishableKey, { stripeAccount: paymentBody.payment.stripeAccountId }) });
  };
  const loadValues = async (checkoutId: string) => {
    const response = await fetch(`/api/shop/${encodeURIComponent(storeSlug)}/checkout/${checkoutId}/values`, { cache: 'no-store' });
    if (response.status === 401) { setValueChecked(true); await startPayment(checkoutId); return; }
    const body = await response.json();
    if (!response.ok) { setValueChecked(true); throw new Error(body.error || 'Account rewards could not be loaded.'); }
    setValueQuote(body.quote); setStoreCredit(String((body.quote.storeCreditCents / 100).toFixed(2))); setValueChecked(true);
  };
  const applyValues = async () => {
    if (!checkout) return; setWorking('values'); setError('');
    try {
      const response = await fetch(`/api/shop/${encodeURIComponent(storeSlug)}/checkout/${checkout.checkoutId}/values`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          rewardId: rewardId ? Number(rewardId) : null,
          storeCreditCents: Math.max(0, Math.round(Number(storeCredit || 0) * 100)),
        }),
      });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Account value could not be reserved.');
      setValueQuote(body.quote); setCheckout({ ...checkout, totalCents: body.quote.payableCents });
      await startPayment(checkout.checkoutId);
    } catch (valueError) { setError(valueError instanceof Error ? valueError.message : 'Account value could not be reserved.'); }
    finally { setWorking(''); }
  };
  const reserve = async () => {
    setWorking('checkout'); setError('');
    try {
      const response = await fetch(`/api/shop/${encodeURIComponent(storeSlug)}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'pickup' ? { fulfilmentType: 'pickup', guestEmail: email, pickupLocationId: Number(selectedId), cart }
          : { fulfilmentType: 'delivery', guestEmail: email, shippingRuleId: Number(selectedId), shippingAddress: address, cart }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Checkout could not be created.'); setCheckout(body.checkout);
      await loadValues(body.checkout.checkoutId);
    } catch (checkoutError) { setError(checkoutError instanceof Error ? checkoutError.message : 'Checkout could not be created.'); }
    finally { setWorking(''); }
  };
  if (!cart.lines.length) return <div className={styles.empty}>Your cart is empty. <Link href={`/shop/${storeSlug}/products`}>Browse products</Link></div>;
  if (checkout) return <div className={`${styles.content} ${styles.checkoutNarrow}`}><div className={styles.checkoutComplete}><span>Stock reserved</span><h1>Complete payment</h1><p>Your items are reserved while payment is in progress.</p>
    {error && <div className={styles.checkoutError} role="alert">{error}</div>}
    {valueQuote && !payment ? <div className={styles.valueSelection}><div><span>Order value</span><strong>{money(valueQuote.grossTotalCents)}</strong></div>
      <label>Loyalty reward<select value={rewardId} onChange={event => setRewardId(event.target.value)}><option value="">No reward</option>{valueQuote.rewards.map(reward => <option key={reward.id} value={reward.id} disabled={!reward.eligible}>{reward.name} · {reward.pointsCost} points · {money(reward.valueCents)}</option>)}</select></label>
      <small>{valueQuote.availableLoyaltyPoints.toLocaleString()} loyalty points available</small>
      <label>Store credit<input type="number" min="0" step="0.01" max={(valueQuote.availableStoreCreditCents / 100).toFixed(2)} value={storeCredit} onChange={event => setStoreCredit(event.target.value)} /></label>
      <small>{money(valueQuote.availableStoreCreditCents)} store credit available</small>
      <button disabled={Boolean(working)} onClick={applyValues}>{working ? 'Applying...' : 'Apply and continue'}</button>
    </div> : null}
    {!valueQuote && valueChecked && !payment ? <button disabled={Boolean(working)} onClick={() => { void startPayment(checkout.checkoutId).catch(paymentError => { setError(paymentError instanceof Error ? paymentError.message : 'Payment could not be started.'); setWorking(''); }); }}>{working ? 'Preparing...' : 'Continue without account value'}</button> : null}
    <div><span>Total due</span><strong>{money(valueQuote?.payableCents ?? checkout.totalCents)}</strong></div>
    {payment ? <Elements stripe={payment.stripe} options={{ clientSecret: payment.clientSecret, appearance: { theme: 'stripe' } }}><StripePaymentForm storeSlug={storeSlug} checkoutId={checkout.checkoutId} /></Elements> : !valueChecked && <p>Checking account rewards...</p>}</div></div>;
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