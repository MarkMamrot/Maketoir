import { notFound } from 'next/navigation';

import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { CheckoutPageClient } from './CheckoutPageClient';

export default async function CheckoutPage({ params }: { params: { slug: string } }) {
  const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug);
  if (!profile) notFound();
  return <CheckoutPageClient storeSlug={profile.slug} />;
}