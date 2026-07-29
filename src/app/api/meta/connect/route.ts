import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { requireAdminTier } from '@/lib/sessionUtils';
import { signMetaOAuthState } from '@/lib/metaOAuth';
import { buildMetaAuthorizeUrl, metaOAuthConfigured } from '@/services/MetaOAuthService';

function appUrl(): string {
  const raw = process.env.APP_URL ?? 'solvantis.com.au';
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/$/, '') : `https://${raw.replace(/\/$/, '')}`;
}

export async function GET() {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const returnUrl = `${appUrl()}/setup`;
  if (!metaOAuthConfigured()) {
    return NextResponse.redirect(`${returnUrl}?metaError=${encodeURIComponent('Meta OAuth is not configured for this deployment.')}`);
  }
  const nonce = randomBytes(24).toString('base64url');
  const redirectUri = `${appUrl()}/api/meta/callback`;
  const state = signMetaOAuthState({ businessId: user.businessId, userId: user.userId, nonce, expiresAt: Date.now() + 10 * 60 * 1000 });
  const redirect = NextResponse.redirect(buildMetaAuthorizeUrl(redirectUri, state));
  redirect.cookies.set('meta_oauth_nonce', nonce, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/meta/callback', maxAge: 10 * 60,
  });
  return redirect;
}