import Link from 'next/link';
import type { StorefrontProductProjection } from '@/lib/storefront/commerce';
import styles from '../Storefront.module.css';

export function ProductGrid({ slug, products }: { slug: string; products: StorefrontProductProjection[] }) {
  if (!products.length) return <div className={styles.empty}>No products are available.</div>;
  return <div className={styles.grid}>{products.map(product => {
    const prices = product.variants.map(variant => variant.price.amount); const from = Math.min(...prices);
    return <article className={styles.product} key={product.productId}><Link href={`/shop/${encodeURIComponent(slug)}/products/${encodeURIComponent(product.slug)}`}>
      {product.images[0] ? <img className={styles.productImage} src={product.images[0].url} alt={product.images[0].altText || product.name} /> : <div className={styles.placeholder}>{product.name}</div>}
      <div className={styles.productMeta}><strong>{product.name}</strong><span>{prices.some(price => price !== from) ? 'From ' : ''}{new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(from)}</span></div>
    </Link></article>;
  })}</div>;
}