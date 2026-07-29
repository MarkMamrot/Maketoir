import { NextResponse } from 'next/server';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { requireAdminTier } from '@/lib/sessionUtils';

export async function POST() {
  const { user, response } = requireAdminTier();
  if (response) return response;
  await ConnectionsRepository.upsert(user.businessId, { meta_ad_account_id: null, meta_access_token: null });
  return NextResponse.json({ success: true });
}