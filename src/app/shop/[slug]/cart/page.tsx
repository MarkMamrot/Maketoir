import { notFound } from 'next/navigation';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { CartPageClient } from './CartPageClient';

export default async function CartPage({ params }: { params: { slug: string } }) {
  const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug); if (!profile) notFound();
  return <CartPageClient storeSlug={profile.slug} />;
}