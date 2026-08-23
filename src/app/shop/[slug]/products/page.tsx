import { notFound } from 'next/navigation';
import { OnlineShopCatalogueRepository } from '@/lib/onlineShop/onlineShopCatalogue';
import { OnlineShopLayoutRepository } from '@/lib/onlineShop/onlineShopLayout';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { SectionRenderer } from '../components/SectionRenderer';

export default async function ShopCatalogue({ params }: { params: { slug: string } }) {
  const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug); if (!profile) notFound();
  const [layout, products] = await Promise.all([OnlineShopLayoutRepository.getPublished(profile.businessId), OnlineShopCatalogueRepository.listPublished(profile.businessId, { limit: 100 })]);
  return <SectionRenderer storeSlug={profile.slug} sections={layout.pages.catalogue.sections} products={products} />;
}