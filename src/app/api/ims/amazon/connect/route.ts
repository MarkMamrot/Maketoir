import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';

import { signAmazonOAuthState } from '@/lib/channels/amazonOAuthState';
import { amazonSpApiConfigured, buildAmazonAuthorizeUrl } from '@/lib/channels/amazonSpApi';
import { requireAdminTier } from '@/lib/sessionUtils';

function appUrl(): string {
  const raw = process.env.APP_URL ?? 'https://solvantis.com.au';
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/$/, '') : `https://${raw.replace(/\/$/, '')}`;
}

function salesChannelsRedirect(message: string): NextResponse {
  return NextResponse.redirect(`${appUrl()}/ims?amazonError=${encodeURIComponent(message)}#sales-channels`);
}

export async function GET(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  if (!amazonSpApiConfigured()) return salesChannelsRedirect('Amazon SP-API is not configured for this deployment.');

  const displayName = new URL(request.url).searchParams.get('displayName')?.trim() ?? '';
  if (!displayName || displayName.length > 120) return salesChannelsRedirect('Enter an Amazon channel name of 120 characters or fewer.');

  const nonce = randomBytes(24).toString('base64url');
  const state = signAmazonOAuthState({
    businessId: user.businessId,
    userId: user.userId,
    nonce,
    displayName,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  const redirect = NextResponse.redirect(buildAmazonAuthorizeUrl(state), {
    headers: { 'Referrer-Policy': 'no-referrer' },
  });
  redirect.cookies.set('amazon_spapi_oauth_nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/ims/amazon/callback',
    maxAge: 10 * 60,
  });
  return redirect;
}
