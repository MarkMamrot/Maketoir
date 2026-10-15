import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import {
  assertOptionalIntegrationEnabled,
  isIntegrationDisabledError,
} from '@/lib/ims/integrationAvailability';
import { KlaviyoService } from '@/services/KlaviyoService';

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
    if (!apiKey) {
      const stored = (await ConnectionsRepository.get(user.businessId))?.klaviyo_api_key ?? '';
      try { apiKey = stored ? decrypt(stored) : ''; }
      catch { apiKey = stored; }
    }
  } catch (error) {
    if (isIntegrationDisabledError(error)) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: 'Unable to load the saved Klaviyo connection.' }, { status: 503 });
  }

  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'Klaviyo API key not provided.' }, { status: 400 });
  }

  try {
    const klaviyo = new KlaviyoService(apiKey);
    const count = await klaviyo.testConnection();
    return NextResponse.json({
      success: true,
      message: `Klaviyo connected — ${count} metric${count !== 1 ? 's' : ''} found.`,
      revision: klaviyo.revision,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: 'Klaviyo connection failed. Check the saved credentials.' }, { status: 401 });
  }
}
