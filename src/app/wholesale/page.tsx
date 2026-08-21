import { redirect } from 'next/navigation';
import { getWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { WholesaleSupplierProfileRepository } from '@/lib/wholesale/wholesaleSupplierProfile';

export default async function WholesalePortalPage() {
  const session = getWholesaleSession();
  if (!session) redirect('/wholesale/login');
  if (session.supplierSlug) redirect(`/wholesale/${session.supplierSlug}`);
  const profile = await WholesaleSupplierProfileRepository.getByBusinessId(session.businessId);
  if (profile?.isActive) redirect(`/wholesale/${profile.slug}`);
  redirect('/wholesale/login');
}
