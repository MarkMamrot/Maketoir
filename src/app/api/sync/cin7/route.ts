import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * GET /api/sync/cin7?accountId=xxx&apiKey=xxx
 * Lightweight connection test — credentials come from the business's setup form.
 * Requires an active session.
 */
export async function GET(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('accountId') ?? '';
  const apiKey    = searchParams.get('apiKey')    ?? '';

  if (!accountId || !apiKey) {
    return NextResponse.json({ success: false, error: 'accountId and apiKey are required.' }, { status: 400 });
  }

  try {
    const auth = Buffer.from(`${accountId}:${apiKey}`).toString('base64');
    const res = await fetch('https://api.cin7.com/api/v1/Products?rows=1', {
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Cin7 returned HTTP ${res.status}`);
    }
    return NextResponse.json({ success: true, message: `Connected to Cin7 account: ${accountId}` });
  } catch {
    return NextResponse.json({ success: false, error: 'Cin7 connection failed. Check credentials.' }, { status: 400 });
  }
}
