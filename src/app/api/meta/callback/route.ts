import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { encrypt } from '@/lib/encryption';
import { verifyMetaOAuthState } from '@/lib/metaOAuth';
import { getAdminSession } from '@/lib/sessionUtils';
import { exchangeMetaCode, listMetaAdAccounts } from '@/services/MetaOAuthService';

function appUrl(): string {
  const raw = process.env.APP_URL ?? 'solvantis.com.au';
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/$/, '') : `https://${raw.replace(/\/$/, '')}`;
}

function setupRedirect(message: string, success = false): NextResponse {
  return NextResponse.redirect(`${appUrl()}/setup?${success ? 'metaSuccess' : 'metaError'}=${encodeURIComponent(message)}`);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = getAdminSession();
  const state = verifyMetaOAuthState(url.searchParams.get('state') ?? '');
  const nonce = cookies().get('meta_oauth_nonce')?.value;
  if (!session || !state || state.userId !== session.userId || state.businessId !== session.businessId || state.nonce !== nonce) {
    const redirect = setupRedirect('Meta authorisation session expired or was invalid. Try connecting again.');
    redirect.cookies.delete('meta_oauth_nonce');
    return redirect;
  }
  const error = url.searchParams.get('error');
  if (error) {
    const redirect = setupRedirect(error === 'access_denied' ? 'Meta access was denied.' : (url.searchParams.get('error_description') || `Meta returned ${error}.`));
    redirect.cookies.delete('meta_oauth_nonce');
    return redirect;
  }
  const code = url.searchParams.get('code');
  if (!code) return setupRedirect('Meta did not return an authorisation code.');

  try {
    const token = await exchangeMetaCode(code, `${appUrl()}/api/meta/callback`);
    const accounts = await listMetaAdAccounts(token);
    if (accounts.length === 0) throw new Error('No accessible Meta ad accounts were found for this login.');
    if (accounts.length === 1) {
      await ConnectionsRepository.upsert(session.businessId, {
        meta_ad_account_id: accounts[0].accountId,
        meta_access_token: encrypt(token),
      });
      const redirect = setupRedirect(`Connected to ${accounts[0].name}.`, true);
      redirect.cookies.delete('meta_oauth_nonce');
      return redirect;
    }
    const redirect = NextResponse.redirect(`${appUrl()}/setup?metaSelect=1`);
    redirect.cookies.set('meta_oauth_pending', encrypt(token), {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/meta', maxAge: 10 * 60,
    });
    redirect.cookies.delete('meta_oauth_nonce');
    return redirect;
  } catch (error) {
    const redirect = setupRedirect(error instanceof Error ? error.message : 'Meta connection failed.');
    redirect.cookies.delete('meta_oauth_nonce');
    return redirect;
  }
}