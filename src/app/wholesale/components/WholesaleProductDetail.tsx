'use client';

import { useEffect, useState } from 'react';
import { Heart, ShoppingCart, X } from 'lucide-react';
import styles from './WholesaleProductDetail.module.css';

type DetailVariant = {
  variant_id: string;
  sku: string | null;
  option1_value: string | null;
  option2_value: string | null;
  option3_value: string | null;
  price_wholesale: number;
  pack_size: number | null;
  available: number;
};

export type WholesaleProductDetailProduct = {
  product_id: string;
  name: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  allow_indent_wholesale: number;
  image_url: string | null;
  images?: string[];
  variants: DetailVariant[];
};

function label(variant: DetailVariant) {
  return [variant.option1_value, variant.option2_value, variant.option3_value].filter(Boolean).join(' / ') || 'Default';
}

export function WholesaleProductDetail({
  product,
  favouriteVariantIds,
  cartQuantities,
  onAdd,
  onToggleFavourite,
  onClose,
}: {
  product: WholesaleProductDetailProduct;
  favouriteVariantIds: Set<string>;
  cartQuantities: Record<string, number>;
  onAdd: (variant: DetailVariant, variantLabel: string) => void;
  onToggleFavourite: (variantId: string) => void;
  onClose: () => void;
}) {
  const images = product.images?.length ? product.images : product.image_url ? [product.image_url] : [];
  const [activeImage, setActiveImage] = useState(images[0] ?? '');

  useEffect(() => setActiveImage(images[0] ?? ''), [product.product_id]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  return (
    <div className={styles.layer} role="dialog" aria-modal="true" aria-labelledby="product-detail-title">
      <button className={styles.backdrop} onClick={onClose} aria-label="Close product details" />
      <section className={styles.panel}>
        <header className={styles.header}>
          <div><span>{product.brand || 'Wholesale catalogue'}</span><h2 id="product-detail-title">{product.name}</h2></div>
          <button className={styles.iconButton} onClick={onClose} aria-label="Close product details" title="Close"><X size={18} /></button>
        </header>
        <div className={styles.body}>
          <div className={styles.gallery}>
            <div className={styles.imageStage}>
              {activeImage ? <img src={activeImage} alt={product.name} /> : <span>No product image</span>}
            </div>
            {images.length > 1 && <div className={styles.thumbnails}>{images.map(image => (
              <button key={image} className={activeImage === image ? styles.thumbnailActive : ''} onClick={() => setActiveImage(image)} aria-label="View product image">
                <img src={image} alt="" />
              </button>
            ))}</div>}
          </div>
          <div className={styles.information}>
            <p className={styles.path}>{[product.category, product.subcategory].filter(Boolean).join(' / ')}</p>
            {product.description && <p className={styles.description}>{product.description}</p>}
            <div className={styles.matrix}>
              <div className={styles.matrixHead}><span>Variant</span><span>Pack</span><span>Available</span><span>Price</span><span>Actions</span></div>
              {product.variants.map(variant => {
                const variantLabel = label(variant);
                const favourite = favouriteVariantIds.has(variant.variant_id);
                const orderable = variant.available > 0 || !!product.allow_indent_wholesale;
                return (
                  <div className={styles.matrixRow} key={variant.variant_id}>
                    <div><strong>{variantLabel}</strong><small>{variant.sku || 'No SKU'}</small></div>
                    <span>{variant.pack_size && variant.pack_size > 1 ? `${variant.pack_size} units` : 'Single'}</span>
                    <span className={variant.available > 0 ? styles.available : product.allow_indent_wholesale ? styles.indent : styles.unavailable}>{variant.available > 0 ? variant.available : product.allow_indent_wholesale ? 'Indent' : 'Out'}</span>
                    <strong>${Number(variant.price_wholesale).toFixed(2)}</strong>
                    <div className={styles.actions}>
                      <button className={styles.iconButton} onClick={() => onToggleFavourite(variant.variant_id)} aria-label={`${favourite ? 'Remove' : 'Add'} ${variantLabel} ${favourite ? 'from' : 'to'} favourites`} title={favourite ? 'Remove favourite' : 'Add favourite'}><Heart size={15} fill={favourite ? 'currentColor' : 'none'} /></button>
                      <button className={styles.addButton} disabled={!orderable} onClick={() => onAdd(variant, variantLabel)}><ShoppingCart size={15} /> {cartQuantities[variant.variant_id] ? `Add (${cartQuantities[variant.variant_id]})` : 'Add'}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}