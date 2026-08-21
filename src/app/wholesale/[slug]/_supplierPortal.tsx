import { notFound } from 'next/navigation';
import WholesalePortalClient from '../_client';
import { getActiveWholesaleBuyer } from '@/lib/wholesale/wholesaleIdentity';
import { getWholesaleSession, type ActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { WholesaleSupplierProfileRepository } from '@/lib/wholesale/wholesaleSupplierProfile';
import type { WholesalePortalView } from '../components/WholesalePortalShell';
import SupplierSignIn from './_signInClient';

export async function SupplierPortal({ slug, view }: { slug: string; view: WholesalePortalView }) {
  const profile = await WholesaleSupplierProfileRepository.getActiveBySlug(slug);
  if (!profile) notFound();

  const session = getWholesaleSession();
  const belongsToSupplier = session?.businessId === profile.businessId
    && (!session.supplierSlug || session.supplierSlug === profile.slug);

  if (session && belongsToSupplier) {
    const buyer = await getActiveWholesaleBuyer(profile.businessId, session.contactId, session.locationId);
    if (buyer) {
      const activeSession: ActiveWholesaleSession = {
        ...session,
        email: buyer.email,
        name: buyer.name,
        company: buyer.company,
        companyId: buyer.companyId,
        locationId: buyer.locationId,
        memberId: buyer.memberId,
        memberRole: buyer.memberRole,
      };
      return <WholesalePortalClient session={activeSession} supplier={profile} initialView={view} />;
    }
  }

  return <SupplierSignIn supplier={profile} />;
}