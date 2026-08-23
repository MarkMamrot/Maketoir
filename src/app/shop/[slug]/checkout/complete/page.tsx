import { notFound } from 'next/navigation';

import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { CheckoutCompleteClient } from './CheckoutCompleteClient';

export default async function CheckoutCompletePage({ params, searchParams }: { params: { slug: string }; searchParams: { checkoutId?: string } }) {
  const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug);
  if (!profile || !/^[0-9a-f-]{36}$/i.test(searchParams.checkoutId ?? '')) notFound();
  return <CheckoutCompleteClient storeSlug={profile.slug} checkoutId={searchParams.checkoutId!} />;
}