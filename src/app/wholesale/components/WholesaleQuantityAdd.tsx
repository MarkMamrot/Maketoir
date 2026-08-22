'use client';

import { useEffect, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { wholesaleEntryQuantityToUnits, wholesalePackSize } from '@/lib/wholesale/wholesaleOrderQuantity';
import type { WholesaleOrderQuantityMode } from '@/lib/wholesale/wholesalePortalSettings';

export function WholesaleQuantityAdd({
  productName,
  variantLabel,
  packSize,
  available,
  allowIndent,
  quantityMode,
  inCart,
  onAdd,
  compact = false,
}: {
  productName: string;
  variantLabel: string;
  packSize: number | null;
  available: number;
  allowIndent: boolean;
  quantityMode: WholesaleOrderQuantityMode;
  inCart: number;
  onAdd: (units: number) => void;
  compact?: boolean;
}) {
  const effectivePackSize = quantityMode === 'pack' ? wholesalePackSize(packSize) : 1;
  const maximum = allowIndent ? undefined : Math.floor(available / effectivePackSize);
  const orderable = allowIndent || maximum > 0;
  const [quantity, setQuantity] = useState(1);

  useEffect(() => setQuantity(1), [productName, variantLabel, quantityMode]);

  const add = () => {
    if (!orderable) return;
    const bounded = Math.max(1, maximum === undefined ? quantity : Math.min(quantity, maximum));
    onAdd(wholesaleEntryQuantityToUnits(bounded, packSize, quantityMode));
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <label style={{ display: 'grid', gap: 2, color: '#64748b', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>
        {quantityMode === 'pack' && effectivePackSize > 1 ? 'Packs' : 'Qty'}
        <input
          aria-label={`${productName} ${variantLabel} quantity${quantityMode === 'pack' && effectivePackSize > 1 ? ' in packs' : ''}`}
          type="number"
          inputMode="numeric"
          min={1}
          max={maximum}
          step={1}
          value={quantity}
          disabled={!orderable}
          onChange={event => setQuantity(Math.max(1, Number.parseInt(event.target.value, 10) || 1))}
          style={{ width: compact ? 50 : 62, height: 32, padding: '0 7px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', color: '#1e293b', fontSize: 12 }}
        />
      </label>
      <button
        type="button"
        disabled={!orderable}
        onClick={add}
        aria-label={`Add ${productName} ${variantLabel} to cart`}
        style={{ minHeight: 32, alignSelf: 'end', display: 'inline-flex', alignItems: 'center', gap: 5, padding: compact ? '0 8px' : '0 11px', border: 0, borderRadius: 4, background: inCart > 0 ? '#dbeafe' : '#2563eb', color: inCart > 0 ? '#1d4ed8' : '#fff', cursor: orderable ? 'pointer' : 'not-allowed', fontSize: 11, fontWeight: 700, opacity: orderable ? 1 : .5 }}
      >
        <ShoppingCart size={14} /> {inCart > 0 ? `Add (${inCart})` : 'Add'}
      </button>
    </div>
  );
}
