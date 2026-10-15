import { NextResponse } from 'next/server';
import {
  getOptionalIntegrationAvailability,
  isIntegrationAvailabilityNotReadyError,
  isOptionalIntegrationProvider,
  setOptionalIntegrationAvailability,
} from '@/lib/ims/integrationAvailability';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminSession, requireAdminTier } from '@/lib/sessionUtils';

export const dynamic = 'force-dynamic';

function unavailableResponse() {
  return NextResponse.json({
    error: 'Integration availability is not ready for this business. Contact support if this continues.',
  }, { status: 503, headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
}

export async function GET() {
  const { user, response } = requireAdminSession();
  if (response) return response;

  try {
    const availability = await getOptionalIntegrationAvailability(user.businessId);
    const integrations = Object.fromEntries(
      Object.entries(availability).map(([provider, state]) => [
        provider,
        { enabled: state.enabled, configured: state.configured },
      ]),
    );
    return NextResponse.json({
      success: true,
      businessId: user.businessId,
      integrations,
      canManage: user.tier === 'Admin' || user.tier === 'SuperAdmin',
    }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: user.businessId,
      source: 'ims.integrations',
      operation: 'load_availability',
      title: 'Integration availability could not be loaded',
      error,
    }).catch(() => null);
    return isIntegrationAvailabilityNotReadyError(error)
      ? unavailableResponse()
      : NextResponse.json({ error: 'Unable to load integration availability.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;

  const body = await request.json().catch(() => null) as {
    provider?: unknown; enabled?: unknown; expectedBusinessId?: unknown;
  } | null;
  if (!body || !isOptionalIntegrationProvider(body.provider) || typeof body.enabled !== 'boolean') {
    return NextResponse.json({
      error: 'Body must contain a supported provider and an enabled boolean.',
    }, { status: 400 });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'expectedBusinessId')
    && body.expectedBusinessId !== user.businessId) {
    return NextResponse.json({
      success: false,
      businessId: user.businessId,
      error: 'The selected business changed. Reload integration settings before saving.',
      code: 'business_context_changed',
    }, { status: 409, headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  }

  try {
    const availability = await setOptionalIntegrationAvailability(
      user.businessId,
      body.provider,
      body.enabled,
    );
    return NextResponse.json({
      success: true,
      businessId: user.businessId,
      provider: body.provider,
      enabled: availability.enabled,
      configured: availability.configured,
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: user.businessId,
      source: 'ims.integrations',
      operation: 'save_availability',
      title: 'Integration availability could not be saved',
      error,
      context: { provider: body.provider, enabled: body.enabled },
      reference: { type: 'integration_provider', id: body.provider },
    }).catch(() => null);
    return isIntegrationAvailabilityNotReadyError(error)
      ? unavailableResponse()
      : NextResponse.json({ error: 'Unable to save integration availability.' }, { status: 500 });
  }
}
