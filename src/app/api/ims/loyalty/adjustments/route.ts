import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { LoyaltyValidationError } from '@/lib/ims/LoyaltyRepository';
import { LoyaltyService } from '@/lib/loyalty/LoyaltyService';
import { ShopifyLoyaltyMetafieldService } from '@/lib/loyalty/ShopifyLoyaltyMetafieldService';

const ADJUSTMENT_TIERS = new Set(['Admin', 'SuperAdmin']);

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session?.businessId) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  if (!ADJUSTMENT_TIERS.has(String(session.tier ?? ''))) {
    return NextResponse.json({ error: 'Only an Admin or SuperAdmin can adjust loyalty points.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const contactId = Number(body?.contactId);
  const pointsDelta = Number(body?.pointsDelta);
  const reason = String(body?.reason ?? '').trim();
  const idempotencyKey = String(body?.idempotencyKey ?? '').trim();
  if (!Number.isInteger(contactId) || contactId <= 0) {
    return NextResponse.json({ error: 'A valid customer is required.' }, { status: 400 });
  }
  if (!Number.isInteger(pointsDelta) || pointsDelta === 0) {
    return NextResponse.json({ error: 'Enter a non-zero whole-number points adjustment.' }, { status: 400 });
  }
  if (!reason || reason.length > 500) {
    return NextResponse.json({ error: 'Enter a reason of 500 characters or fewer.' }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9:_-]{8,191}$/.test(idempotencyKey)) {
    return NextResponse.json({ error: 'A valid adjustment request key is required.' }, { status: 400 });
  }

  try {
    const result = await LoyaltyService.recordTransaction({
      businessId: session.businessId,
      contactId,
      type: 'adjustment',
      pointsDelta,
      channel: 'manual',
      sourceType: 'ims_manual_adjustment',
      sourceId: idempotencyKey,
      idempotencyKey,
      actorId: session.userId ?? null,
      reason,
    });
    const shopifySync = await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({
      businessId: session.businessId,
      contactId,
    });
    return NextResponse.json({
      success: true,
      adjustment: result,
      shopifySync,
      warning: shopifySync.status === 'failed' ? 'Points were adjusted, but Shopify could not be updated.' : null,
    });
  } catch (error) {
    if (error instanceof LoyaltyValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Loyalty points could not be adjusted.' }, { status: 500 });
  }
}