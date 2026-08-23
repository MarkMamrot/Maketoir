import { notFound } from 'next/navigation';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { OnlineShopLoginClient } from './OnlineShopLoginClient';

export default async function OnlineShopLoginPage({ params }: { params: { slug: string } }) {
  const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug); if (!profile) notFound();
  return <OnlineShopLoginClient storeSlug={profile.slug} />;
}