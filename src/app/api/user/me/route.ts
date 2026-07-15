import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/services/MySQLService';

export async function GET() {
  try {
    const session = cookies().get('marketoir_session');
    if (!session?.value) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }
    const user = JSON.parse(session.value);

    // Look up has_foresight from the businesses table (not stored in the cookie)
    let hasForesight = false;
    const businessId = user.businessId ?? '';
    if (businessId) {
      const rows = await query<{ has_foresight: number }>(
        'SELECT has_foresight FROM businesses WHERE business_id = ? AND deleted_at IS NULL LIMIT 1',
        [businessId],
      ).catch(() => []);
      hasForesight = !!(rows[0]?.has_foresight);
    }

    return NextResponse.json({
      name:         user.name       ?? '',
      email:        user.email      ?? '',
      company:      user.company    ?? '',
      tier:         user.tier       ?? 'StandardUser',
      businessId,
      hasForesight,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 400 });
  }
}
