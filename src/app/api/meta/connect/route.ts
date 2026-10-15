import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { requireAdminTier } from '@/lib/sessionUtils';
import { signMetaOAuthState } from '@/lib/metaOAuth';
import { buildMetaAuthorizeUrl, metaOAuthConfigured } from '@/services/MetaOAuthService';
import { assertOptionalIntegrationEnabled, isIntegrationDisabledError } from '@/lib/ims/integrationAvailability';

function appUrl(): string {
  const raw = process.env.APP_URL ?? 'solvantis.com.au';
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/$/, '') : `https://${raw.replace(/\/$/, '')}`;
}

export async function GET() {
  const { user, response } = requireAdminTier();
  if (response) return response;
  try {
    await assertOptionalIntegrationEnabled(user.businessId, 'meta');
  } catch (error) {
    if (isIntegrationDisabledError(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: 'Meta integration availability is not ready.' }, { status: 503 });
  }
  const returnUrl = `${appUrl()}/ims`;
  if (!metaOAuthConfigured()) {
    return NextResponse.redirect(`${returnUrl}?metaError=${encodeURIComponent('Meta OAuth is not configured for this deployment.')}#settings-connection-meta`);
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