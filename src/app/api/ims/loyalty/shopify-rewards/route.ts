import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { getShopifyOperationContext, ShopifyOperationContextError } from '@/lib/channels/shopifyOperationContext';
import { LoyaltyRepository, LoyaltyValidationError } from '@/lib/ims/LoyaltyRepository';
import { LoyaltyService } from '@/lib/loyalty/LoyaltyService';
import { ShopifyRewardIssuanceService } from '@/lib/loyalty/ShopifyRewardIssuanceService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';
import { ShopifyAdminUserError, ShopifyService } from '@/services/ShopifyService';

function scopeHint(error: string): string {
  if (/access|scope|permission|forbidden|unauthori[sz]ed/i.test(error)) {
    return `${error} Add the write_discounts scope to the Shopify custom app, reinstall/update its token, and save the new token in Setup -> Connections.`;
  }
  return error;
}

export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session?.businessId) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  const contactId = Number(new URL(request.url).searchParams.get('contactId'));
  const channelInstanceId = new URL(request.url).searchParams.get('channelInstanceId')?.trim() ?? '';
  if (!channelInstanceId) return NextResponse.json({ error: 'channelInstanceId is required.' }, { status: 400 });
  if (!Number.isInteger(contactId) || contactId <= 0) {
    return NextResponse.json({ error: 'A valid customer is required.' }, { status: 400 });
  }
  try {
    const contacts = await imsQuery<{ loyalty_member: number; external_customer_id: string | null }>(
      `SELECT contact.loyalty_member, mapping.external_customer_id
         FROM ims_contacts contact
         LEFT JOIN ims_contact_channel_mappings mapping
           ON mapping.business_id = contact.business_id AND mapping.contact_id = contact.id
          AND mapping.channel_instance_id = ? AND mapping.mapping_status = 'linked'
        WHERE contact.id = ? AND contact.business_id = ? AND contact.is_active = 1
          AND type IN ('retail_customer','b2b_customer','both')
        LIMIT 1`,
      [channelInstanceId, contactId, session.businessId],
    );
    const contact = contacts[0];
    if (!contact) return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });

    const settings = await LoyaltyService.getSettings(session.businessId);
    const member = Boolean(contact.loyalty_member);
    const active = settings.enabled && (!settings.startedAt || new Date().toISOString().slice(0, 10) >= settings.startedAt);
    const [account, rewards, issuedRedemptions] = member
      ? await Promise.all([
          LoyaltyRepository.getAccount(session.businessId, contactId),
          active ? LoyaltyRepository.listRewards(session.businessId) : Promise.resolve([]),
          imsQuery<{
            id: number;
            display_name: string;
            value_aud: number;
            status: string;
            voucher_code: string;
            created_at: string;
          }>(
            `SELECT r.id, rw.display_name, rw.value_aud, r.status, r.voucher_code, r.created_at
               FROM loyalty_redemptions r
               JOIN loyalty_accounts a ON a.id = r.account_id AND a.business_id = r.business_id
               JOIN loyalty_rewards rw ON rw.id = r.reward_id AND rw.business_id = r.business_id
              WHERE r.business_id = ? AND a.contact_id = ? AND r.voucher_code IS NOT NULL
                AND r.status IN ('issued','used')
              ORDER BY r.created_at DESC
              LIMIT 20`,
            [session.businessId, contactId],
          ),
        ])
      : [null, [], []];

    return NextResponse.json({
      success: true,
      loyalty: {
        canAdjustPoints: ['Admin', 'SuperAdmin'].includes(String(session.tier ?? '')),
        enabled: settings.enabled,
        active,
        member,
        shopifyLinked: Boolean(contact.external_customer_id),
        programName: settings.programName,
        pointsLabel: settings.pointsLabel,
        balancePoints: account?.balancePoints ?? 0,
        rewards,
        issuedRedemptions: issuedRedemptions.map(redemption => ({
          id: Number(redemption.id),
          rewardName: redemption.display_name,
          valueAud: Number(redemption.value_aud),
          status: redemption.status,
          voucherCode: redemption.voucher_code,
          createdAt: redemption.created_at,
        })),
      },
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'shopify_loyalty',
      operation: 'get_ims_customer_rewards',
      title: 'IMS customer loyalty rewards failed to load',
      error,
      context: { contactId },
      reference: { type: 'ims_contact', id: contactId },
    });
    return NextResponse.json({ error: 'Could not load loyalty rewards.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session?.businessId) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'A JSON request body is required.' }, { status: 400 });
  }
  const contactId = Number(body.contactId);
  const rewardId = Number(body.rewardId);
  const channelInstanceId = typeof body.channelInstanceId === 'string' ? body.channelInstanceId.trim() : '';
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!Number.isInteger(contactId) || contactId <= 0 || !Number.isInteger(rewardId) || rewardId <= 0 || !idempotencyKey || !channelInstanceId) {
    return NextResponse.json({ error: 'contactId, rewardId, idempotencyKey, and channelInstanceId are required.' }, { status: 400 });
  }

  try {
    const context = await getShopifyOperationContext({ businessId: session.businessId, channelInstanceId });
    const result = await ShopifyRewardIssuanceService.issue({
      businessId: session.businessId,
      channelInstanceId,
      contactId,
      rewardId,
      idempotencyKey,
      actorId: session.userId ?? null,
      shopify: new ShopifyService(context.credentials.shopDomain, context.credentials.token),
    });
    return NextResponse.json({ success: true, redemption: result });
  } catch (error) {
    if (error instanceof LoyaltyValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ShopifyOperationContextError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Shopify reward code issuance failed.';
    return NextResponse.json({ error: scopeHint(message) }, { status: error instanceof ShopifyAdminUserError ? 422 : 502 });
  }
}