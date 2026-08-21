import { notFound } from 'next/navigation';
import { WholesaleSupplierProfileRepository } from '@/lib/wholesale/wholesaleSupplierProfile';
import VerifyApplicationEmail from './_verifyClient';

export const dynamic = 'force-dynamic';

export default async function VerifyWholesaleApplicationPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { token?: string };
}) {
  const profile = await WholesaleSupplierProfileRepository.getActiveBySlug(params.slug);
  if (!profile) notFound();
  return <VerifyApplicationEmail slug={profile.slug} token={searchParams.token ?? ''} supplierName={profile.displayName} />;
}