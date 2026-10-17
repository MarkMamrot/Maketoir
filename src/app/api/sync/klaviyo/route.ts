import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import {
  assertOptionalIntegrationEnabled,
  isIntegrationDisabledError,
} from '@/lib/ims/integrationAvailability';
import { KlaviyoService } from '@/services/KlaviyoService';
import { createKlaviyoClient } from '@/lib/klaviyo/oauth';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

/**
 * POST /api/sync/klaviyo { apiKey }
 * Lightweight connection test — verifies the API key is valid.
 */
export async function POST(req: Request) {
  const { user, response: authResponse } = requireAdminSession();
  if (authResponse) return authResponse;

  const body = await req.json().catch(() => ({})) as { apiKey?: unknown };
  let apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  try {
    await assertOptionalIntegrationEnabled(user.businessId, 'klaviyo');
  } catch (error) {
    if (isIntegrationDisabledError(error)) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: 'Unable to load the saved Klaviyo connection.' }, { status: 503 });
  }

  try {
    const klaviyo = apiKey ? new KlaviyoService(apiKey) : await createKlaviyoClient(user.businessId);
    const count = await klaviyo.testConnection();
    return NextResponse.json({
      success: true,
      message: `Klaviyo connected — ${count} metric${count !== 1 ? 's' : ''} found.`,
      revision: klaviyo.revision,
    });
  } catch (e: any) {
    await reportRuntimeIssue({ businessId: user.businessId, source: 'klaviyo.oauth', operation: 'test_connection',
      title: 'Klaviyo connection test failed', error: e }).catch(() => null);
    return NextResponse.json({ success: false, error: 'Klaviyo connection failed. Reconnect your Klaviyo account.' }, { status: 401 });
  }
}
