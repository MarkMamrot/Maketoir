import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';


/**
 * GET /api/sync/meta-ads?adAccountId=xxx&accessToken=xxx
 * Lightweight connection test — credentials come from the business's setup form.
 * Requires an active session.
 */
export async function GET(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const adAccountId = searchParams.get('adAccountId') ?? '';
  const accessToken = searchParams.get('accessToken') ?? '';

  if (!adAccountId || !accessToken) {
    return NextResponse.json({ success: false, error: 'adAccountId and accessToken are required.' }, { status: 400 });
  }

  try {
    const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${accountId}?fields=id,name&access_token=${accessToken}`
    );
    const data = await res.json();
    if (data.error) {
      return NextResponse.json({ success: false, error: data.error.message }, { status: 401 });
    }
    return NextResponse.json({ success: true, message: `Connected to Meta ad account: ${data.name ?? accountId}` });
  } catch {
    return NextResponse.json({ success: false, error: 'Meta Ads connection failed.' }, { status: 500 });
  }
}



