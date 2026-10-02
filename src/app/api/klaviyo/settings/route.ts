import { NextResponse } from 'next/server';

import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { parseKlaviyoIntegrationSettings } from '@/lib/klaviyo/contracts';
import { isKlaviyoTenantSchemaReady } from '@/lib/klaviyo/schemaReadiness';
import { KlaviyoSettingsRepository } from '@/lib/klaviyo/settingsRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { assertBusinessAccess, requireAdminTier } from '@/lib/sessionUtils';

export async function GET(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const businessId = new URL(request.url).searchParams.get('databaseId');
  const accessResponse = assertBusinessAccess(user, businessId);
  if (accessResponse) return accessResponse;

  try {
    const [settings, tenantReady] = await Promise.all([
      KlaviyoSettingsRepository.get(businessId!),
      runImsForBusiness(businessId!, isKlaviyoTenantSchemaReady),
    ]);
    return NextResponse.json({ success: true, settings, tenantReady });
  } catch (error) {
    await reportRuntimeIssue({ businessId, source: 'klaviyo.settings', operation: 'load',
      title: 'Klaviyo settings could not be loaded', error }).catch(() => null);
    return NextResponse.json({ success: false, error: 'Unable to load Klaviyo settings.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const businessId = typeof body?.databaseId === 'string' ? body.databaseId : null;
  const accessResponse = assertBusinessAccess(user, businessId);
  if (accessResponse) return accessResponse;
  const settings = parseKlaviyoIntegrationSettings(body?.settings);
  const hasCommerceSource = Object.values(settings.sources).some(Boolean);
  if (settings.enabled && hasCommerceSource && !settings.profilesEnabled) {
    return NextResponse.json({ success: false, error: 'Profile sync is required for enabled commerce event sources.' }, { status: 400 });
  }

  try {
    if (settings.enabled) {
      const tenantReady = await runImsForBusiness(businessId!, isKlaviyoTenantSchemaReady);
      if (!tenantReady) {
        return NextResponse.json({ success: false, error: 'Klaviyo sync is not available for this business yet.' }, { status: 409 });
      }
      const connection = await ConnectionsRepository.get(businessId!);
      if (!connection?.klaviyo_api_key) {
        return NextResponse.json({ success: false, error: 'Save a Klaviyo API key before enabling the integration.' }, { status: 400 });
      }
    }
    await KlaviyoSettingsRepository.save(businessId!, settings);
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save Klaviyo settings.';
    if (message.includes('duplicate-event risk')) {
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }
    await reportRuntimeIssue({ businessId, source: 'klaviyo.settings', operation: 'save',
      title: 'Klaviyo settings could not be saved', error }).catch(() => null);
    return NextResponse.json({ success: false, error: 'Unable to save Klaviyo settings.' }, { status: 500 });
  }
}