'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import styles from '../../Storefront.module.css';

export function CheckoutCompleteClient({ storeSlug, checkoutId }: { storeSlug: string; checkoutId: string }) {
  const [status, setStatus] = useState('payment_pending'); const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const response = await fetch(`/api/shop/${encodeURIComponent(storeSlug)}/checkout/${checkoutId}/status`, { cache: 'no-store' });
        const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Order status could not be loaded.');
        if (stopped) return; setStatus(body.checkout.status);
        if (body.checkout.status !== 'completed') timer = setTimeout(check, 1500);
      } catch (loadError) { if (!stopped) setError(loadError instanceof Error ? loadError.message : 'Order status could not be loaded.'); }
    };
    void check(); return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [storeSlug, checkoutId]);
  return <div className={`${styles.content} ${styles.checkoutNarrow}`}><div className={styles.checkoutComplete}>
    <span>{status === 'completed' ? 'Order confirmed' : 'Payment received'}</span><h1>{status === 'completed' ? 'Thank you' : 'Finalising your order'}</h1>
    <p>{error || (status === 'completed' ? 'Your order is now with the fulfilment team.' : 'This usually takes only a few seconds. You can safely leave this page.')}</p>
    {status === 'completed' && <Link className={styles.checkoutButton} href={`/shop/${storeSlug}/products`}>Continue shopping</Link>}
  </div></div>;
}