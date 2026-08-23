import type { OnlineShopContentPageSection, OnlineShopLayoutSection } from '@/lib/onlineShop/layout/types';
import type { StorefrontProductProjection } from '@/lib/storefront/commerce';
import { ProductGrid } from './ProductGrid';
import styles from '../Storefront.module.css';

export function SectionRenderer({ storeSlug, sections, products = [] }: { storeSlug: string; sections: Array<OnlineShopLayoutSection | OnlineShopContentPageSection>; products?: StorefrontProductProjection[] }) {
  return <>{sections.map(section => {
    const settings = section.settings; const style = { backgroundColor: settings.backgroundColor, color: settings.textColor };
    const wrap = (content: React.ReactNode) => <section key={section.id} className={styles.section} style={style} data-width={settings.width ?? 'content'} data-align={settings.alignment ?? 'left'} data-top={settings.spacingTop ?? 'medium'} data-bottom={settings.spacingBottom ?? 'medium'}><div>{content}</div></section>;
    if (section.type === 'shop_home' || section.type === 'shop_catalogue' || section.type === 'shop_collection' || section.type === 'featured_products') return wrap(<><div className={styles.catalogueHead}><h2>{settings.heading || (section.type === 'shop_home' ? 'New arrivals' : 'Products')}</h2></div><ProductGrid slug={storeSlug} products={section.type === 'featured_products' && settings.productIds?.length ? products.filter(product => settings.productIds!.includes(product.productId)).slice(0, settings.productLimit ?? 4) : products} /></>);
    if (section.type === 'banner') return wrap(<div className={styles.banner}><div><h2>{settings.heading}</h2>{settings.bodyHtml && <div className={styles.richText} dangerouslySetInnerHTML={{ __html: settings.bodyHtml }} />}</div></div>);
    if (section.type === 'rich_text') return wrap(<><h2>{settings.heading}</h2><div className={styles.richText} dangerouslySetInnerHTML={{ __html: settings.bodyHtml ?? '' }} /></>);
    if (section.type === 'image' && settings.imageUrl) return wrap(<img className={styles.image} data-ratio={settings.imageRatio ?? 'landscape'} src={settings.imageUrl} alt={settings.altText ?? ''} />);
    if (section.type === 'text_image') return wrap(<div className={styles.split} data-side={settings.imageSide ?? 'right'}><div><h2>{settings.heading}</h2><div className={styles.richText} dangerouslySetInnerHTML={{ __html: settings.bodyHtml ?? '' }} /></div>{settings.imageUrl && <div className={styles.splitImage}><img className={styles.image} data-ratio={settings.imageRatio ?? 'landscape'} src={settings.imageUrl} alt={settings.altText ?? ''} /></div>}</div>);
    if (section.type === 'divider') return wrap(<div className={styles.divider} />);
    if (section.type === 'spacer') return wrap(null);
    return null;
  })}</>;
}