import { NextResponse } from 'next/server';

import { assertNativeShopEnabled, isOnlineChannelDisabledError } from '@/lib/ims/businessOperations';

export async function nativeShopDisabledResponse(businessId: string): Promise<NextResponse | null> {
  try {
    await assertNativeShopEnabled(businessId);
    return null;
  } catch (error) {
    if (!isOnlineChannelDisabledError(error)) throw error;
    return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
  }
}
