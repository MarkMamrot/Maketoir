import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { KlaviyoService } from '@/services/KlaviyoService';

/**
 * POST /api/sync/klaviyo { apiKey }
 * Lightweight connection test — verifies the API key is valid.
 */
export async function POST(req: Request) {
  const { response: authResponse } = requireAdminSession();
  if (authResponse) return authResponse;

  const { apiKey = '' } = await req.json().catch(() => ({})) as { apiKey?: string };

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
    return NextResponse.json({ success: false, error: e.message ?? 'Network error' }, { status: 401 });
  }
}
