import { NextResponse } from 'next/server';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { requireAdminTier } from '@/lib/sessionUtils';

export async function POST() {
  const { user, response } = requireAdminTier();
  if (response) return response;
  await ConnectionsRepository.upsert(user.businessId, { google_ads_customer_id: null, google_ads_refresh_token: null, ga4_property_id: null });
  return NextResponse.json({ success: true });
}
