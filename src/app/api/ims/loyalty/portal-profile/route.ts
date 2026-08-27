import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { LoyaltyPortalProfileRepository } from '@/lib/loyalty/LoyaltyPortalProfile';
import { buildHostedLoyaltyPolicies } from '@/lib/loyalty/LoyaltyPolicyTemplates';
import { LoyaltyService } from '@/lib/loyalty/LoyaltyService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminTier } from '@/lib/sessionUtils';

function duplicate(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY'); }

export async function GET() {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({ success: true, profile: await LoyaltyPortalProfileRepository.getByBusinessId(auth.user.businessId) });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'loyalty_portal', operation: 'load_profile', title: 'Loyalty portal settings could not be loaded', error }).catch(() => {});
    return NextResponse.json({ error: 'Loyalty portal settings could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'A valid JSON body is required.' }, { status: 400 }); }
  try {
    if (body?.isActive === true) {
      const [connection, settings] = await Promise.all([
        ConnectionsRepository.get(auth.user.businessId),
        runImsForBusiness(auth.user.businessId, () => LoyaltyService.getSettings(auth.user.businessId)),
      ]);
      if (!settings.enabled) return NextResponse.json({ error: 'Enable and save the loyalty program before publishing the portal.' }, { status: 400 });
      if (!connection?.shopify_shop_id || !connection.shopify_access_token) return NextResponse.json({ error: 'Connect Shopify before publishing the loyalty portal.' }, { status: 400 });
    }
    await LoyaltyPortalProfileRepository.upsert({
      businessId: auth.user.businessId,
      slug: body?.slug,
      displayName: String(body?.displayName ?? ''),
      logoUrl: typeof body?.logoUrl === 'string' ? body.logoUrl : null,
      shopifyReturnUrl: String(body?.shopifyReturnUrl ?? ''),
      termsUrl: String(body?.termsUrl ?? ''),
      termsVersion: String(body?.termsVersion ?? ''),
      privacyUrl: String(body?.privacyUrl ?? ''),
      policyMode: body?.policyMode === 'hosted' ? 'hosted' : 'external',
      merchant: body?.merchant && typeof body.merchant === 'object' ? body.merchant : {},
      isActive: body?.isActive === true,
      policyApproved: body?.policyApproved === true,
      approvedBy: { userId: auth.user.userId, name: auth.user.name || auth.user.email },
    });
    return NextResponse.json({ success: true, profile: await LoyaltyPortalProfileRepository.getByBusinessId(auth.user.businessId) });
  } catch (error) {
    if (duplicate(error)) return NextResponse.json({ error: 'That loyalty portal address is already in use.' }, { status: 409 });
    if (error instanceof Error && /required|valid|slug|URL|version|reviewed|approved|hosted|external|characters/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'loyalty_portal', operation: 'save_profile', title: 'Loyalty portal settings could not be saved', error }).catch(() => {});
    return NextResponse.json({ error: 'Loyalty portal settings could not be saved.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  try {
    const body = await request.json();
    const snapshot = buildHostedLoyaltyPolicies(body?.merchant ?? {});
    return NextResponse.json({
      success: true,
      preview: {
        templateVersion: snapshot.templateVersion,
        termsMarkdown: snapshot.termsMarkdown,
        privacyMarkdown: snapshot.privacyMarkdown,
      },
    });
  } catch (error) {
    if (error instanceof Error && /required|valid|characters/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'loyalty_portal', operation: 'preview_policies', title: 'Loyalty policy preview could not be generated', error }).catch(() => {});
    return NextResponse.json({ error: 'Loyalty policy preview could not be generated.' }, { status: 500 });
  }
}