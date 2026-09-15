import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { authorizeAmazonChannel } from '@/lib/channels/amazonChannelRepository';
import { verifyAmazonOAuthState } from '@/lib/channels/amazonOAuthState';
import {
  exchangeAmazonAuthorizationCode,
  getAmazonMarketplaceParticipations,
  requireActiveAmazonAustraliaParticipation,
} from '@/lib/channels/amazonSpApi';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getAdminSession } from '@/lib/sessionUtils';

function appUrl(): string {
  const raw = process.env.APP_URL ?? 'https://solvantis.com.au';
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/$/, '') : `https://${raw.replace(/\/$/, '')}`;
}

function redirect(message: string, success = false): NextResponse {
  const response = NextResponse.redirect(`${appUrl()}/ims?${success ? 'amazonSuccess' : 'amazonError'}=${encodeURIComponent(message)}#sales-channels`, {
    headers: { 'Referrer-Policy': 'no-referrer' },
  });
  response.cookies.delete('amazon_spapi_oauth_nonce');
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = getAdminSession();
  const state = verifyAmazonOAuthState(url.searchParams.get('state') ?? '');
  const nonce = cookies().get('amazon_spapi_oauth_nonce')?.value;
  if (!session || (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') || !state
    || state.userId !== session.userId || state.businessId !== session.businessId || state.nonce !== nonce) {
    return redirect('Amazon authorisation session expired or was invalid. Start again.');
  }

  const oauthError = url.searchParams.get('error');
  if (oauthError) return redirect(oauthError === 'access_denied' ? 'Amazon access was denied.' : 'Amazon authorisation was not completed.');
  const code = url.searchParams.get('spapi_oauth_code')?.trim() ?? '';
  const sellerId = url.searchParams.get('selling_partner_id')?.trim() ?? '';
  if (!code || !sellerId) return redirect('Amazon did not return the required seller authorisation.');

  try {
    const redirectUri = `${appUrl()}/api/ims/amazon/callback`;
    const token = await exchangeAmazonAuthorizationCode(code, redirectUri);
    const participation = requireActiveAmazonAustraliaParticipation(
      await getAmazonMarketplaceParticipations(token.accessToken),
    );
    await authorizeAmazonChannel({
      businessId: session.businessId,
      sellerId,
      displayName: state.displayName,
      storeName: participation.storeName,
      refreshToken: token.refreshToken,
    });
    return redirect(`Amazon Australia seller ${sellerId} connected. Complete channel setup before activation.`, true);
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'ims.channels',
      operation: 'authorize_amazon',
      title: 'Amazon channel authorisation failed',
      error,
      context: { provider: 'amazon' },
      reference: sellerId ? { type: 'amazon_seller', id: sellerId } : undefined,
    }).catch(() => null);
    const message = error instanceof Error && /does not have access|not participating|suspended|already connected/i.test(error.message)
      ? error.message
      : 'Amazon connection could not be completed.';
    return redirect(message);
  }
}
