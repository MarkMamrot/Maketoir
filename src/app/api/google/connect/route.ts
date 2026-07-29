import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { requireAdminTier } from '@/lib/sessionUtils';
import { signGoogleMarketingOAuthState } from '@/lib/googleMarketingOAuth';
import { buildGoogleMarketingAuthorizeUrl, googleMarketingOAuthConfigurationStatus } from '@/services/GoogleMarketingOAuthService';

function appUrl(): string {
  const raw = process.env.APP_URL ?? 'solvantis.com.au';
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/$/, '') : `https://${raw.replace(/\/$/, '')}`;
}

export async function GET() {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const returnUrl = `${appUrl()}/setup`;
  if (!googleMarketingOAuthConfigurationStatus().configured) {
    return NextResponse.redirect(`${returnUrl}?googleError=${encodeURIComponent('Google OAuth is not configured for this deployment.')}`);
  }
  const nonce = randomBytes(24).toString('base64url');
  const redirectUri = `${appUrl()}/api/google/callback`;
  const state = signGoogleMarketingOAuthState({ businessId: user.businessId, userId: user.userId, nonce, expiresAt: Date.now() + 10 * 60 * 1000 });
  const redirect = NextResponse.redirect(buildGoogleMarketingAuthorizeUrl(redirectUri, state));
  redirect.cookies.set('google_marketing_oauth_nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/google/callback',
    maxAge: 10 * 60,
  });
  return redirect;
}
