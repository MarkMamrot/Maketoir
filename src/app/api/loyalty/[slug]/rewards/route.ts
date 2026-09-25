import { NextResponse } from 'next/server';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { LoyaltyValidationError } from '@/lib/ims/LoyaltyRepository';
import { getLoyaltyPortalAuth } from '@/lib/loyalty/LoyaltyPortalAuth';
import { ShopifyRewardIssuanceService } from '@/lib/loyalty/ShopifyRewardIssuanceService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';
import { ShopifyAdminUserError, ShopifyService } from '@/services/ShopifyService';

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  const auth = await getLoyaltyPortalAuth(params.slug);
  if (!auth) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const body = await request.json();
  const rewardId = Number(body?.rewardId);
  const requestKey = String(body?.idempotencyKey ?? '').trim();
  if (!Number.isInteger(rewardId) || rewardId <= 0 || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestKey)) return NextResponse.json({ error: 'A valid reward and request key are required.' }, { status: 400 });
  try {
    return await runImsForBusiness(auth.profile.businessId, async () => {
      const channelInstanceId = auth.session.channelInstanceId;
      const context = await getShopifyOperationContext({ businessId: auth.profile.businessId, channelInstanceId });
      const contacts = await imsQuery<{ id: number }>(`SELECT id FROM ims_contacts WHERE id=? AND business_id=? AND loyalty_member=1 AND is_active=1 LIMIT 1`, [auth.session.contactId, auth.profile.businessId]);
      if (!contacts[0]) return NextResponse.json({ error: 'Active loyalty membership is required.' }, { status: 403 });
      const result = await ShopifyRewardIssuanceService.issue({ businessId: auth.profile.businessId, channelInstanceId, contactId: auth.session.contactId, rewardId, idempotencyKey: `loyalty-portal:${channelInstanceId}:${auth.session.contactId}:${requestKey}`, actorId: `loyalty-portal:${auth.session.contactId}`, shopify: new ShopifyService(context.credentials.shopDomain, context.credentials.token) });
      return NextResponse.json({ success: true, redemption: result });
    });
  } catch (error) {
    if (error instanceof LoyaltyValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof ShopifyAdminUserError) return NextResponse.json({ error: 'Shopify could not create this discount.' }, { status: 422 });
    await reportRuntimeIssue({ businessId: auth.profile.businessId, source: 'loyalty_portal', operation: 'issue_shopify_discount', title: 'Loyalty portal Shopify discount issuance failed', error, context: { contactId: auth.session.contactId, rewardId }, reference: { type: 'ims_contact', id: auth.session.contactId } });
    return NextResponse.json({ error: 'The Shopify discount could not be created. Retry using the same request.' }, { status: 502 });
  }
}