import { NextResponse } from 'next/server';

import { assertShopifyEnabled, isOnlineChannelDisabledError } from '@/lib/ims/businessOperations';

export async function shopifyDisabledResponse(businessId: string): Promise<NextResponse | null> {
  try {
    await assertShopifyEnabled(businessId);
    return null;
  } catch (error) {
    if (!isOnlineChannelDisabledError(error)) throw error;
    return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
  }
}