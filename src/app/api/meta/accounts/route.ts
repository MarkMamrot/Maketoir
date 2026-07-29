import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt, encrypt } from '@/lib/encryption';
import { requireAdminTier } from '@/lib/sessionUtils';
import { listMetaAdAccounts } from '@/services/MetaOAuthService';

function pendingToken(): string {
  const stored = cookies().get('meta_oauth_pending')?.value ?? '';
  return stored ? decrypt(stored) : '';
}

export async function GET() {
  const { response } = requireAdminTier();
  if (response) return response;
  const token = pendingToken();
  if (!token) return NextResponse.json({ error: 'Meta account selection expired. Connect again.' }, { status: 410 });
  try {
    return NextResponse.json({ success: true, accounts: await listMetaAdAccounts(token) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load Meta ad accounts.' }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const token = pendingToken();
  if (!token) return NextResponse.json({ error: 'Meta account selection expired. Connect again.' }, { status: 410 });
  const body = await request.json().catch(() => ({})) as { accountId?: unknown };
  const accountId = String(body.accountId ?? '').replace(/^act_/i, '').trim();
  const accounts = await listMetaAdAccounts(token);
  const selected = accounts.find((account) => account.accountId === accountId);
  if (!selected) return NextResponse.json({ error: 'Select an ad account returned by Meta.' }, { status: 400 });
  await ConnectionsRepository.upsert(user.businessId, { meta_ad_account_id: selected.accountId, meta_access_token: encrypt(token) });
  const result = NextResponse.json({ success: true, account: selected });
  result.cookies.delete('meta_oauth_pending');
  return result;
}