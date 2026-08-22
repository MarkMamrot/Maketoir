'use client';

import { LockKeyhole, Minus, Package, Plus, ShoppingCart } from 'lucide-react';
import type { WholesaleLayoutPageId, WholesaleLayoutSection } from '@/lib/wholesale/layout/types';
import { WholesaleLayoutPageRenderer } from './WholesaleLayoutPageRenderer';
import styles from './WholesaleLayoutCanvasSample.module.css';

type SampleProduct = {
  product_id: string;
  name: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  image_url: string | null;
  images?: string[];
  variants: Array<{
    variant_id: string;
    sku: string | null;
    option1_value: string | null;
    option2_value: string | null;
    option3_value: string | null;
    price_wholesale: number;
    available: number;
  }>;
};

type SampleCartItem = {
  variant_id: string;
  product_name: string;
  variant_label: string;
  qty: number;
  unit_price: number;
};

function currency(value: number) {
  return value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

function variantName(product: SampleProduct, index: number) {
  const variant = product.variants[index];
  return variant ? [variant.option1_value, variant.option2_value, variant.option3_value].filter(Boolean).join(' / ') || 'Default' : '';
}

function LoginAccess({ supplierName }: { supplierName: string }) {
  return (
    <div className={styles.loginPage}>
      <section className={styles.loginPanel}>
        <div className={styles.loginMark}>{supplierName.charAt(0).toUpperCase()}</div>
        <p>Wholesale portal</p>
        <h1>Sign in to {supplierName}</h1>
        <label>Email address<input type="email" placeholder="buyer@example.com" disabled /></label>
        <label>Password<input type="password" value="password" readOnly disabled /></label>
        <button type="button" disabled><LockKeyhole size={16} /> Sign in</button>
        <span>Login preview is design-only.</span>
      </section>
    </div>
  );
}

function LoginSample({ supplierName, sections, products }: { supplierName: string; sections: WholesaleLayoutSection[]; products: SampleProduct[] }) {
  return <WholesaleLayoutPageRenderer sections={sections} systemSections={{ login_access: <LoginAccess supplierName={supplierName} /> }} products={products} />;
}

function ProductMedia({ product }: { product: SampleProduct | null }) {
  const image = product?.images?.[0] || product?.image_url;
  return (
    <section className={styles.productMedia}>
      <div className={styles.productImage}>{image ? <img src={image} alt="" /> : <Package size={42} />}</div>
      <div className={styles.productCopy}>
        <p>{product?.brand || 'Wholesale catalogue'}</p>
        <h1>{product?.name || 'Sample product'}</h1>
        <span>{[product?.category, product?.subcategory].filter(Boolean).join(' / ') || 'Category / Subcategory'}</span>
        <div className={styles.description}>{product?.description || 'Product description appears here.'}</div>
      </div>
    </section>
  );
}

function ProductVariants({ product }: { product: SampleProduct | null }) {
  const variants = product?.variants.slice(0, 4) ?? [];
  return (
    <section className={styles.variants}>
      <header><div><p>Variant ordering</p><h2>Choose products</h2></div><ShoppingCart size={20} /></header>
      {variants.length ? variants.map((variant, index) => (
        <div className={styles.variant} key={variant.variant_id}>
          <div><strong>{variantName(product!, index)}</strong><span>{variant.sku || 'No SKU'} · {variant.available} available</span></div>
          <b>{currency(variant.price_wholesale)}</b>
          <div className={styles.stepper}><button disabled><Minus size={13} /></button><span>0</span><button disabled><Plus size={13} /></button></div>
        </div>
      )) : <div className={styles.empty}>A product with variants will be shown here.</div>}
    </section>
  );
}

function ProductSample({ product, sections, products }: { product: SampleProduct | null; sections: WholesaleLayoutSection[]; products: SampleProduct[] }) {
  return <div className={styles.productPage}><WholesaleLayoutPageRenderer sections={sections} systemSections={{ product_media_description: <ProductMedia product={product} />, product_variants: <ProductVariants product={product} /> }} products={products} /></div>;
}

function CartWorkflow({ items }: { items: SampleCartItem[] }) {
  const sampleItems = items.slice(0, 4);
  const subtotal = sampleItems.reduce((sum, item) => sum + item.qty * item.unit_price, 0);
  return (
    <div className={styles.cartPage}>
      <section className={styles.cartPanel}>
        <header><p>Current order</p><h1>Cart</h1></header>
        <div className={styles.cartBody}>
          {sampleItems.length ? sampleItems.map(item => <div className={styles.cartItem} key={item.variant_id}><div><strong>{item.product_name}</strong><span>{item.variant_label}</span></div><span>{item.qty} × {currency(item.unit_price)}</span><b>{currency(item.qty * item.unit_price)}</b></div>) : <div className={styles.empty}>Your current cart is empty. Sample order lines will appear here.</div>}
        </div>
        <footer><span>Subtotal</span><strong>{currency(subtotal)}</strong><button disabled>Review order</button></footer>
      </section>
    </div>
  );
}

function sampleCartItems(products: SampleProduct[]): SampleCartItem[] {
  return products.slice(0, 2).map((product, index) => ({
    variant_id: product.variants[0]?.variant_id || `layout-sample-${product.product_id}`,
    product_name: product.name,
    variant_label: variantName(product, 0) || 'Default',
    qty: index + 1,
    unit_price: product.variants[0]?.price_wholesale || 0,
  }));
}

function CartSample({ items, sections, products }: { items: SampleCartItem[]; sections: WholesaleLayoutSection[]; products: SampleProduct[] }) {
  const previewItems = items.length ? items : sampleCartItems(products);
  return <WholesaleLayoutPageRenderer sections={sections} systemSections={{ cart_workflow: <CartWorkflow items={previewItems} /> }} products={products} />;
}

export function WholesaleLayoutCanvasSample({ page, supplierName, sections, product, products, cartItems }: {
  page: Extract<WholesaleLayoutPageId, 'login' | 'product' | 'cart'>;
  supplierName: string;
  sections: WholesaleLayoutSection[];
  product: SampleProduct | null;
  products: SampleProduct[];
  cartItems: SampleCartItem[];
}) {
  if (page === 'login') return <LoginSample supplierName={supplierName} sections={sections} products={products} />;
  if (page === 'product') return <ProductSample product={product} sections={sections} products={products} />;
  return <CartSample items={cartItems} sections={sections} products={products} />;
}
