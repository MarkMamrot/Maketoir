import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { WholesaleSupplierProfileRepository } from '@/lib/wholesale/wholesaleSupplierProfile';
import type { WholesalePortalView } from '../../components/WholesalePortalShell';
import { SupplierPortal } from '../_supplierPortal';

export const dynamic = 'force-dynamic';

const sections = new Set<WholesalePortalView>(['catalogue', 'orders', 'account', 'help']);

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const profile = await WholesaleSupplierProfileRepository.getActiveBySlug(params.slug);
  return profile
    ? { title: `${profile.displayName} Wholesale`, robots: { index: false, follow: false } }
    : { title: 'Wholesale Portal' };
}

export default function WholesaleSectionPage({ params }: { params: { slug: string; section: string } }) {
  if (!sections.has(params.section as WholesalePortalView)) notFound();
  return <SupplierPortal slug={params.slug} view={params.section as WholesalePortalView} />;
}