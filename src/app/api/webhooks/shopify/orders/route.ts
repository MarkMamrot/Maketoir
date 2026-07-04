/**
 * DEPRECATED — /api/webhooks/shopify/orders (no businessId).
 *
 * Webhooks must now target /api/webhooks/shopify/orders/{businessId} so events
 * route to the correct tenant. This stub returns 410 Gone so a misconfigured
 * (old) webhook is obvious in Shopify's webhook delivery logs.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  return NextResponse.json(
    { error: 'Deprecated. Register your webhook at /api/webhooks/shopify/orders/{businessId}.' },
    { status: 410 },
  );
}
