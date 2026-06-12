import { NextResponse } from 'next/server';

/**
 * Lightweight ping — verifies Cin7 credentials with a single-row request.
 * Accepts accountId and apiKey as query params (per-business).
 * Falls back to env vars if not provided.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('accountId') || process.env.CIN7_ACCOUNT_ID || '';
  const apiKey = searchParams.get('apiKey') || process.env.CIN7_API_KEY || '';

  if (!accountId || !apiKey) {
    return NextResponse.json({ success: false, error: 'Cin7 Omni credentials not configured.' }, { status: 400 });
  }

  try {
    const auth = Buffer.from(`${accountId}:${apiKey}`).toString('base64');
    const res = await fetch('https://api.cin7.com/api/v1/Products?rows=1', {
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Cin7 Omni returned HTTP ${res.status}`);
    }
    return NextResponse.json({ success: true, message: `Connected to Cin7 Omni account: ${accountId}` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
