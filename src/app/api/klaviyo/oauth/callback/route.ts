import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { requireAdminTier } from '@/lib/sessionUtils';
import { readKlaviyoAuthorization, saveKlaviyoAuthorization } from '@/lib/klaviyo/oauth';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { assertOptionalIntegrationEnabled } from '@/lib/ims/integrationAvailability';

export async function GET(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const params = new URL(request.url).searchParams;
  const cookie = cookies().get('klaviyo_oauth_state')?.value ?? '';
  cookies().set('klaviyo_oauth_state', '', { path: '/api/klaviyo/oauth', maxAge: 0 });
  const authorization = readKlaviyoAuthorization(cookie, params.get('state') ?? '', user.businessId, user.userId);
  const destination = new URL('/ims', process.env.APP_URL || request.url);
  destination.hash = 'connection-klaviyo';
  if (!authorization) {
    destination.searchParams.set('klaviyoError', 'Connection request expired or does not match this business. Please reconnect.');
  } else if (params.has('error') || !params.get('code')) {
    destination.searchParams.set('klaviyoError', 'Klaviyo access was not approved. Connect again to allow access.');
  } else {
    try {
      await assertOptionalIntegrationEnabled(user.businessId, 'klaviyo');
      await saveKlaviyoAuthorization(user.businessId, params.get('code')!, authorization.verifier);
      destination.searchParams.set('klaviyoSuccess', 'Connected to Klaviyo.');
    } catch (error) {
      await reportRuntimeIssue({ businessId: user.businessId, source: 'klaviyo.oauth', operation: 'callback',
        title: 'Klaviyo authorization failed', error }).catch(() => null);
      destination.searchParams.set('klaviyoError', 'Unable to finish connecting Klaviyo. Please try again.');
    }
  }
  return NextResponse.redirect(destination);
}