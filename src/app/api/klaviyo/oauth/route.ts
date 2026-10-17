import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { requireAdminTier } from '@/lib/sessionUtils';
import { createKlaviyoAuthorization, disconnectKlaviyoOAuth, hasKlaviyoOAuthConnection, klaviyoOAuthConfig } from '@/lib/klaviyo/oauth';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { assertOptionalIntegrationEnabled } from '@/lib/ims/integrationAvailability';

export async function GET() {
  const { user, response } = requireAdminTier();
  if (response) return response;
  let configured = false;
  try { klaviyoOAuthConfig(); configured = true; } catch { /* Configuration is reported as unavailable. */ }
  try {
    const [connected, legacy] = await Promise.all([
      hasKlaviyoOAuthConnection(user.businessId), ConnectionsRepository.get(user.businessId),
    ]);
    return NextResponse.json({ configured, connected: connected || Boolean(legacy?.klaviyo_api_key), oauth: connected });
  } catch (error) {
    await reportRuntimeIssue({ businessId: user.businessId, source: 'klaviyo.oauth', operation: 'status',
      title: 'Klaviyo connection status failed', error }).catch(() => null);
    return NextResponse.json({ error: 'Unable to load Klaviyo connection status.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  try {
    await assertOptionalIntegrationEnabled(user.businessId, 'klaviyo');
    const authorization = createKlaviyoAuthorization(user.businessId, user.userId);
    cookies().set('klaviyo_oauth_state', authorization.cookie, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
      path: '/api/klaviyo/oauth', maxAge: 600,
    });
    return NextResponse.json({ url: authorization.url });
  } catch (error) {
    await reportRuntimeIssue({ businessId: user.businessId, source: 'klaviyo.oauth', operation: 'authorize',
      title: 'Klaviyo authorization could not start', error }).catch(() => null);
    return NextResponse.json({ error: 'Klaviyo connection is not configured. Contact your Solvantis administrator.' }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  try {
    await disconnectKlaviyoOAuth(user.businessId);
    return NextResponse.json({ success: true });
  } catch (error) {
    await reportRuntimeIssue({ businessId: user.businessId, source: 'klaviyo.oauth', operation: 'disconnect',
      title: 'Klaviyo disconnect failed', error }).catch(() => null);
    return NextResponse.json({ error: 'Unable to disconnect Klaviyo. Try again.' }, { status: 502 });
  }
}