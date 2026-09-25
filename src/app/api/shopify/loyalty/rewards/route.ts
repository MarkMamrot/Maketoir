import { NextResponse } from 'next/server';

import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getContactChannelMapping } from '@/lib/ims/contactChannelMappings';
import { LoyaltyValidationError } from '@/lib/ims/LoyaltyRepository';
import {
  ShopifyCustomerAccountAuthError,
  verifyShopifyCustomerAccountToken,
} from '@/lib/loyalty/ShopifyCustomerAccountAuth';
import { ShopifyRewardIssuanceService } from '@/lib/loyalty/ShopifyRewardIssuanceService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { query } from '@/services/MySQLService';
import { ShopifyAdminUserError, ShopifyService } from '@/services/ShopifyService';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const MAX_REQUEST_BYTES = 2_048;

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (!contentType.startsWith('application/json')) {
    return json({ error: 'Content-Type must be application/json.' }, 415);
  }
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ error: 'Request body is too large.' }, 413);
  }
  let body: unknown;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_REQUEST_BYTES) {
      return json({ error: 'Request body is too large.' }, 413);
    }
    body = JSON.parse(rawBody);
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

  let instance;
  try {
    const instances = await query<{ business_id: string; channel_instance_id: string }>(
      `SELECT business_id, channel_instance_id
         FROM sales_channel_instances
        WHERE provider = 'shopify' AND external_account_key = ?
          AND is_enabled = 1 AND runtime_status = 'active' AND readiness_status = 'ready'
        LIMIT 2`,
      [identity.shopDomain],
    );
    instance = instances.length === 1 ? instances[0] : null;
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
  if (!instance) {
    return json({ error: 'This Shopify store is not connected to Solvantis.' }, 403);
  }

  const businessId = instance.business_id;
  const channelInstanceId = instance.channel_instance_id;
  try {
    const context = await getShopifyOperationContext({ businessId, channelInstanceId });
    return await runImsForBusiness(businessId, async () => {
      const mapping = await getContactChannelMapping({
        businessId,
        channelInstanceId,
        externalCustomerId: identity.shopifyCustomerId,
      });
      if (!mapping || mapping.mappingStatus !== 'linked') {
        return json({ error: 'An enrolled loyalty customer could not be resolved.' }, 403);
      }

      const result = await ShopifyRewardIssuanceService.issue({
        businessId,
        channelInstanceId,
        contactId: mapping.contactId,
        rewardId,
        idempotencyKey: `shopify-account:${channelInstanceId}:${identity.shopifyCustomerId}:${requestKey}`,
        actorId: `shopify-customer:${identity.shopifyCustomerId}`,
        shopify: new ShopifyService(context.credentials.shopDomain, context.credentials.token),
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
      context: { channelInstanceId, shopDomain: identity.shopDomain, shopifyCustomerId: identity.shopifyCustomerId, rewardId },
      reference: { type: 'shopify_customer', id: identity.shopifyCustomerId },
    });
    return json({ error: 'The reward could not be issued. Retry using the same request.' }, 502);
  }
}