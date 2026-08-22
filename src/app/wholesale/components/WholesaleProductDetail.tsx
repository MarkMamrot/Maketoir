'use client';

import { useEffect, useState } from 'react';
import { Heart, ShoppingCart, X } from 'lucide-react';
import styles from './WholesaleProductDetail.module.css';
import type { WholesaleProductImageFit, WholesaleProductImageRatio } from '@/lib/wholesale/wholesalePortalSettings';
import type { WholesaleLayoutSection } from '@/lib/wholesale/layout/types';
import { WholesaleLayoutPageRenderer, type WholesaleLayoutFeaturedProduct } from './layout/WholesaleLayoutPageRenderer';

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
  imageFit,
  imageRatio,
  favouriteVariantIds,
  cartQuantities,
  onAdd,
  onToggleFavourite,
  onClose,
  layoutSections,
  featuredProducts,
}: {
  product: WholesaleProductDetailProduct;
  imageFit: WholesaleProductImageFit;
  imageRatio: WholesaleProductImageRatio;
  favouriteVariantIds: Set<string>;
  cartQuantities: Record<string, number>;
  onAdd: (variant: DetailVariant, variantLabel: string) => void;
  onToggleFavourite: (variantId: string) => void;
  onClose: () => void;
  layoutSections: WholesaleLayoutSection[];
  featuredProducts: WholesaleLayoutFeaturedProduct[];
}) {
  const images = product.images?.length ? product.images : product.image_url ? [product.image_url] : [];
  const [activeImage, setActiveImage] = useState(images[0] ?? '');
  const [descriptionMode, setDescriptionMode] = useState<'source' | 'preview'>('preview');

  useEffect(() => setActiveImage(images[0] ?? ''), [product.product_id]);
  useEffect(() => setDescriptionMode('preview'), [product.product_id]);
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
        <div className={styles.layoutBody}>
        <WholesaleLayoutPageRenderer sections={layoutSections} products={featuredProducts} systemSections={{
          product_media_description: <div className={styles.body}>
          <div className={styles.gallery}>
            <div className={styles.imageStage} data-ratio={imageRatio}>
              {activeImage ? <img src={activeImage} alt={product.name} /> : <span>No product image</span>}
            </div>
            {images.length > 1 && <div className={styles.thumbnails} data-fit={imageFit} data-ratio={imageRatio}>{images.map(image => (
              <button key={image} className={activeImage === image ? styles.thumbnailActive : ''} onClick={() => setActiveImage(image)} aria-label="View product image">
                <img src={image} alt="" loading="lazy" decoding="async" />
              </button>
            ))}</div>}
          </div>
          <div className={styles.information}>
            <p className={styles.path}>{[product.category, product.subcategory].filter(Boolean).join(' / ')}</p>
            {product.description && (
              <section className={styles.descriptionSection}>
                <div className={styles.descriptionHeader}>
                  <h3>Description</h3>
                  <div className={styles.descriptionModes} role="group" aria-label="Description display mode">
                    {(['source', 'preview'] as const).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={descriptionMode === mode}
                        className={descriptionMode === mode ? styles.descriptionModeActive : ''}
                        onClick={() => setDescriptionMode(mode)}
                      >
                        {mode === 'source' ? 'HTML' : 'Preview'}
                      </button>
                    ))}
                  </div>
                </div>
                {descriptionMode === 'source' ? (
                  <pre className={styles.descriptionSource}>{product.description}</pre>
                ) : (
                  <div className={styles.description} dangerouslySetInnerHTML={{ __html: product.description }} />
                )}
              </section>
            )}
          </div>
        </div>,
          product_variants: <div className={styles.variantBody}>
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
          </div>,
        }} />
        </div>
      </section>
    </div>
  );
}