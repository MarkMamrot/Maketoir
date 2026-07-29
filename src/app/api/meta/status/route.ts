import { NextResponse } from 'next/server';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { requireAdminSession } from '@/lib/sessionUtils';
import { metaOAuthConfigurationStatus, readMetaAdAccount } from '@/services/MetaOAuthService';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const connection = await ConnectionsRepository.get(user.businessId);
  const configuration = metaOAuthConfigurationStatus();
  return NextResponse.json({
    ...configuration,
    connected: Boolean(connection?.meta_ad_account_id && connection?.meta_access_token),
    accountId: connection?.meta_ad_account_id ?? null,
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
}

export async function POST() {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const connection = await ConnectionsRepository.get(user.businessId);
  if (!connection?.meta_ad_account_id || !connection.meta_access_token) {
    return NextResponse.json({ success: false, error: 'Meta Ads is not connected.' }, { status: 409 });
  }
  try {
    const account = await readMetaAdAccount(decrypt(connection.meta_access_token), connection.meta_ad_account_id);
    return NextResponse.json({ success: true, account });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Meta connection test failed.' }, { status: 502 });
  }
}