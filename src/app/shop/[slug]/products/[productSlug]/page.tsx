import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OnlineShopCatalogueRepository } from '@/lib/onlineShop/onlineShopCatalogue';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { ProductPurchase } from '../../components/ProductPurchase';
import styles from '../../Storefront.module.css';

async function resolve(slug: string, productSlug: string) { const profile = await OnlineShopProfileRepository.getActiveBySlug(slug); if (!profile) return null;
  const product = await OnlineShopCatalogueRepository.getPublishedBySlug(profile.businessId, productSlug); return product ? { profile, product } : null; }
export async function generateMetadata({ params }: { params: { slug: string; productSlug: string } }): Promise<Metadata> { const data = await resolve(params.slug, params.productSlug); return data ? { title: `${data.product.name} | ${data.profile.displayName}` } : {}; }
export default async function ProductPage({ params }: { params: { slug: string; productSlug: string } }) {
  const data = await resolve(params.slug, params.productSlug); if (!data) notFound(); const { profile, product } = data;
  return <div className={styles.content}><div className={styles.productLayout}><div className={styles.gallery}>{product.images.length ? product.images.map(image => <img key={image.id} src={image.url} alt={image.altText || product.name} />) : <div className={styles.placeholder}>{product.name}</div>}</div><ProductPurchase storeSlug={profile.slug} product={product} /></div></div>;
}