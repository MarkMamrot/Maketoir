import { NextResponse } from 'next/server';

import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { decrypt } from '@/lib/encryption';
import { LoyaltyValidationError } from '@/lib/ims/LoyaltyRepository';
import {
  ShopifyCustomerAccountAuthError,
  verifyShopifyCustomerAccountToken,
} from '@/lib/loyalty/ShopifyCustomerAccountAuth';
import { ShopifyRewardIssuanceService } from '@/lib/loyalty/ShopifyRewardIssuanceService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';
import { ShopifyAdminUserError, ShopifyService } from '@/services/ShopifyService';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const clientId = process.env.SHOPIFY_LOYALTY_APP_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.SHOPIFY_LOYALTY_APP_SECRET?.trim() ?? '';
  if (!clientId || !clientSecret) {
    await reportRuntimeIssue({
      source: 'shopify_loyalty',
      operation: 'customer_account_auth_configuration',
      title: 'Shopify customer loyalty app credentials are not configured',
      error: new Error('SHOPIFY_LOYALTY_APP_CLIENT_ID or SHOPIFY_LOYALTY_APP_SECRET is missing.'),
    });
    return json({ error: 'Customer reward claiming is not configured.' }, 503);
  }

  let identity;
  try {
    identity = verifyShopifyCustomerAccountToken({ token, clientId, clientSecret });
  } catch (error) {
    if (error instanceof ShopifyCustomerAccountAuthError) return json({ error: error.message }, 401);
    return json({ error: 'Invalid Shopify session token.' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'A JSON request body is required.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'A JSON request body is required.' }, 400);
  }
  const requestBody = body as Record<string, unknown>;
  const rewardId = Number(requestBody.rewardId);
  const requestKey = typeof requestBody.idempotencyKey === 'string' ? requestBody.idempotencyKey.trim() : '';
  if (!Number.isInteger(rewardId) || rewardId <= 0 || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestKey)) {
    return json({ error: 'A valid reward and idempotency key are required.' }, 400);
  }

  let connection;
  try {
    connection = await ConnectionsRepository.getByShopifyShopDomain(identity.shopDomain);
  } catch (error) {
    await reportRuntimeIssue({
      source: 'shopify_loyalty',
      operation: 'resolve_customer_account_shop',
      title: 'Shopify customer loyalty shop mapping failed',
      error,
      context: { shopDomain: identity.shopDomain },
    });
    return json({ error: 'The Shopify store could not be resolved.' }, 500);
  }
  if (!connection?.shopify_access_token) {
    return json({ error: 'This Shopify store is not connected to Solvantis.' }, 403);
  }

  const businessId = connection.business_id;
  try {
    return await runImsForBusiness(businessId, async () => {
      const contacts = await imsQuery<{ id: number }>(
        `SELECT id
           FROM ims_contacts
          WHERE business_id = ? AND shopify_customer_id = ? AND deleted_at IS NULL AND is_active = 1
            AND loyalty_member = 1 AND type IN ('retail_customer','b2b_customer','both')
          LIMIT 2`,
        [businessId, identity.shopifyCustomerId],
      );
      if (contacts.length !== 1) {
        return json({ error: 'An enrolled loyalty customer could not be resolved.' }, 403);
      }

      let accessToken = connection.shopify_access_token!;
      try { accessToken = decrypt(accessToken); } catch { /* Legacy unencrypted token. */ }
      const result = await ShopifyRewardIssuanceService.issue({
        businessId,
        contactId: Number(contacts[0].id),
        rewardId,
        idempotencyKey: `shopify-account:${identity.shopifyCustomerId}:${requestKey}`,
        actorId: `shopify-customer:${identity.shopifyCustomerId}`,
        shopify: new ShopifyService(connection!.shopify_shop_id ?? identity.shopDomain, accessToken),
      });
      return json({
        success: true,
        redemption: {
          id: result.redemptionId,
          status: result.status,
          voucherCode: result.voucherCode,
          rewardName: result.rewardName,
          rewardValueAud: result.rewardValueAud,
          balanceAfter: result.balanceAfter,
        },
      }, 200);
    });
  } catch (error) {
    if (error instanceof LoyaltyValidationError) return json({ error: error.message }, 400);
    if (error instanceof ShopifyAdminUserError) return json({ error: 'Shopify could not create this reward code.' }, 422);
    await reportRuntimeIssue({
      businessId,
      source: 'shopify_loyalty',
      operation: 'customer_account_claim_reward',
      title: 'Shopify customer reward claim failed',
      error,
      context: { shopDomain: identity.shopDomain, shopifyCustomerId: identity.shopifyCustomerId, rewardId },
      reference: { type: 'shopify_customer', id: identity.shopifyCustomerId },
    });
    return json({ error: 'The reward could not be issued. Retry using the same request.' }, 502);
  }
}