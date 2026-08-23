import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OnlineShopCatalogueRepository } from '@/lib/onlineShop/onlineShopCatalogue';
import { OnlineShopLayoutRepository } from '@/lib/onlineShop/onlineShopLayout';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { SectionRenderer } from './components/SectionRenderer';

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug); if (!profile) return {};
  return { title: profile.defaultMetaTitle || profile.displayName, description: profile.defaultMetaDescription };
}

export default async function ShopHome({ params }: { params: { slug: string } }) {
  const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug); if (!profile) notFound();
  const [layout, products] = await Promise.all([OnlineShopLayoutRepository.getPublished(profile.businessId), OnlineShopCatalogueRepository.listPublished(profile.businessId, { limit: 12 })]);
  return <SectionRenderer storeSlug={profile.slug} sections={layout.pages.home.sections} products={products} />;
}