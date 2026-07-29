import { NextResponse } from 'next/server';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { requireAdminSession } from '@/lib/sessionUtils';
import { metaOAuthConfigured, readMetaAdAccount } from '@/services/MetaOAuthService';

export async function GET() {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const connection = await ConnectionsRepository.get(user.businessId);
  return NextResponse.json({
    configured: metaOAuthConfigured(),
    connected: Boolean(connection?.meta_ad_account_id && connection?.meta_access_token),
    accountId: connection?.meta_ad_account_id ?? null,
  });
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