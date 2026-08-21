import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { WholesaleSupplierProfileRepository } from '@/lib/wholesale/wholesaleSupplierProfile';
import WholesalePortalClient from '../_client';
import SupplierSignIn from './_signInClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const profile = await WholesaleSupplierProfileRepository.getActiveBySlug(params.slug);
  return {
    title: profile ? `${profile.displayName} Wholesale` : 'Wholesale Portal',
    robots: { index: false, follow: false },
  };
}

export default async function SupplierWholesalePage({ params }: { params: { slug: string } }) {
  const profile = await WholesaleSupplierProfileRepository.getActiveBySlug(params.slug);
  if (!profile) notFound();

  const session = getWholesaleSession();
  const belongsToSupplier = session?.businessId === profile.businessId
    && (!session.supplierSlug || session.supplierSlug === profile.slug);

  if (session && belongsToSupplier) {
    return <WholesalePortalClient session={session} />;
  }

  return <SupplierSignIn supplier={profile} />;
}