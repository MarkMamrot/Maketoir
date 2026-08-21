import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { WholesaleSupplierProfileRepository } from '@/lib/wholesale/wholesaleSupplierProfile';
import { SupplierPortal } from './_supplierPortal';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const profile = await WholesaleSupplierProfileRepository.getActiveBySlug(params.slug);
  return {
    title: profile ? `${profile.displayName} Wholesale` : 'Wholesale Portal',
    robots: { index: false, follow: false },
  };
}

export default async function SupplierWholesalePage({ params }: { params: { slug: string } }) {
  return <SupplierPortal slug={params.slug} view="home" />;
}