import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { encrypt } from '@/lib/encryption';
import { verifyGoogleMarketingOAuthState } from '@/lib/googleMarketingOAuth';
import { getAdminSession } from '@/lib/sessionUtils';
import { exchangeGoogleMarketingCode } from '@/services/GoogleMarketingOAuthService';

function appUrl(): string {
  const raw = process.env.APP_URL ?? 'solvantis.com.au';
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/$/, '') : `https://${raw.replace(/\/$/, '')}`;
}

export async function GET(request: Request) {
  const returnUrl = `${appUrl()}/setup`;
  const { searchParams } = new URL(request.url);
  const state = verifyGoogleMarketingOAuthState(searchParams.get('state') ?? '');
  const session = getAdminSession();
  const nonce = cookies().get('google_marketing_oauth_nonce')?.value;
  const invalid = !session || !state || state.userId !== session.userId || state.businessId !== session.businessId || state.nonce !== nonce;
  if (invalid) {
    const redirect = NextResponse.redirect(`${returnUrl}?googleError=${encodeURIComponent('Google authorisation session expired or was invalid. Try connecting again.')}`);
    redirect.cookies.delete('google_marketing_oauth_nonce');
    return redirect;
  }
  const error = searchParams.get('error');
  if (error) return NextResponse.redirect(`${returnUrl}?googleError=${encodeURIComponent(error === 'access_denied' ? 'Google access was denied.' : `Google returned: ${error}`)}`);
  const code = searchParams.get('code');
  if (!code) return NextResponse.redirect(`${returnUrl}?googleError=${encodeURIComponent('Google did not return an authorisation code.')}`);

  try {
    const tokens = await exchangeGoogleMarketingCode(code, `${appUrl()}/api/google/callback`);
    await ConnectionsRepository.upsert(state.businessId, { google_ads_refresh_token: encrypt(tokens.refreshToken) });
    const redirect = NextResponse.redirect(`${returnUrl}?googleSelect=1`);
    redirect.cookies.delete('google_marketing_oauth_nonce');
    redirect.cookies.set('google_marketing_pending', encrypt(tokens.refreshToken), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/google',
      maxAge: 10 * 60,
    });
    return redirect;
  } catch (error) {
    return NextResponse.redirect(`${returnUrl}?googleError=${encodeURIComponent(error instanceof Error ? error.message : 'Google OAuth exchange failed.')}`);
  }
}
