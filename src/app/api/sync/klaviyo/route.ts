import { NextResponse } from 'next/server';

const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const REVISION = '2024-10-15';

function kHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    revision: REVISION,
  };
}

/**
 * GET /api/sync/klaviyo?apiKey=pk_xxx
 * Lightweight connection test — verifies the API key is valid.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const apiKey = searchParams.get('apiKey') || '';

  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'Klaviyo API key not provided.' }, { status: 400 });
  }

  try {
    const res = await fetch(`${KLAVIYO_BASE}/metrics/?page[size]=1`, {
      headers: kHeaders(apiKey),
    });

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        errMsg = body.errors?.[0]?.detail ?? body.detail ?? errMsg;
      } catch {}
      return NextResponse.json({ success: false, error: `Klaviyo rejected the key: ${errMsg}` }, { status: 401 });
    }

    const data = await res.json();
    const count = data.data?.length ?? 0;
    return NextResponse.json({ success: true, message: `Klaviyo connected — ${count} metric${count !== 1 ? 's' : ''} found.` });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message ?? 'Network error' }, { status: 500 });
  }
}
