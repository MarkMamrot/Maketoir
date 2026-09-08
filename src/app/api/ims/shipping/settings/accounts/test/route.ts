import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { AusPostEparcelClient } from '@/lib/ims/shipping/carriers/auspostEparcel/client';
import { ShippingSettingsRepository } from '@/lib/ims/shipping/shippingSettingsRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'A valid carrier account ID is required.' }, { status: 400 });

  try {
    const account = await ShippingSettingsRepository.getAccountCredentials(session.businessId, id);
    if (!account) return NextResponse.json({ error: 'Carrier account or credentials are unavailable.' }, { status: 404 });
    if (account.provider !== 'auspost_eparcel') {
      return NextResponse.json({ error: 'This carrier does not support connection testing yet.' }, { status: 400 });
    }
    const result = await new AusPostEparcelClient({
      apiKey: account.apiKey,
      password: account.password,
      accountNumber: account.accountNumber,
    }).verifyAccount() as Record<string, unknown>;
    const products = Array.isArray(result.postage_products) ? result.postage_products : [];
    await ShippingSettingsRepository.recordVerification(session.businessId, id, {
      merchantLocationId: typeof result.merchant_location_id === 'string' ? result.merchant_location_id : null,
      capabilities: { postageProducts: products },
    });
    return NextResponse.json({ success: true, data: { merchantLocationId: result.merchant_location_id ?? null, productCount: products.length } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to verify the carrier account.';
    await ShippingSettingsRepository.recordVerification(session.businessId, id, { error: message }).catch(() => {});
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'auspost_eparcel',
      operation: 'verify_account',
      title: 'Australia Post account verification failed',
      error,
      context: { carrierAccountId: id },
      reference: { type: 'shipping_carrier_account', id },
    });
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}