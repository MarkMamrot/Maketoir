'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export function CartLink({ storeSlug }: { storeSlug: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const refresh = () => { try { const cart = JSON.parse(localStorage.getItem(`solvantis-native-cart:${storeSlug}`) || '{}'); setCount(Array.isArray(cart.lines) ? cart.lines.reduce((sum: number, line: any) => sum + Math.max(0, Number(line.quantity) || 0), 0) : 0); } catch { setCount(0); } };
    refresh(); window.addEventListener('solvantis-cart-change', refresh); window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('solvantis-cart-change', refresh); window.removeEventListener('storage', refresh); };
  }, [storeSlug]);
  return <Link href={`/shop/${encodeURIComponent(storeSlug)}/cart`}>Cart{count > 0 ? ` (${count})` : ''}</Link>;
}