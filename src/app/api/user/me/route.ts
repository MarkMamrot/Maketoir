import { NextResponse } from 'next/server';
import { emptyBusinessFeatureFlags, getBusinessFeatureFlags } from '@/lib/businessFeatures';
import { getOnlineChannelCapabilities } from '@/lib/ims/businessOperations';
import { findAccessibleBusiness, resolveActorBusinessAccess } from '@/lib/auth/businessAccess';
import { getAdminSession } from '@/lib/sessionUtils';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET() {
  let activeBusinessId: string | undefined;
  try {
    const session = getAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const access = await resolveActorBusinessAccess(session.userId);
    const activeBusiness = access
      ? findAccessibleBusiness(access.businesses, session.businessId)
      : null;
    if (!access || !activeBusiness) {
      return NextResponse.json({ error: 'Business access is no longer available.' }, { status: 403 });
    }

    // Look up has_foresight from the businesses table (not stored in the cookie)
    let hasForesight = false;
    let features = emptyBusinessFeatureFlags();
    let onlineChannels = { shopifyEnabled: false, nativeShopEnabled: false };
    const businessId = activeBusiness.businessId;
    activeBusinessId = businessId;
    if (businessId) {
      hasForesight = activeBusiness.hasForesight;
      features = await getBusinessFeatureFlags(businessId).catch(() => emptyBusinessFeatureFlags());
      onlineChannels = await getOnlineChannelCapabilities(businessId).catch(() => onlineChannels);
    }

    return NextResponse.json({
      name:         access.actor.name ?? '',
      email:        access.actor.email,
      company:      activeBusiness.name,
      tier:         access.actor.tier === 'SuperAdmin' ? 'SuperAdmin' : activeBusiness.tier,
      businessId,
      activeBusiness,
      hasForesight,
      features,
      onlineChannels,
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: activeBusinessId,
      source: 'auth',
      operation: 'user_context_load',
      severity: 'error',
      title: 'Active business context could not be loaded',
      error,
    }).catch(() => null);
    return NextResponse.json({ error: 'Business context could not be loaded.' }, { status: 500 });
  }
}
