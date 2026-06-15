import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  try {
    const session = cookies().get('marketoir_session');
    if (!session?.value) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }
    const user = JSON.parse(session.value);
    return NextResponse.json({
      name:    user.name    ?? '',
      email:   user.email   ?? '',
      company: user.company ?? '',
      userSpreadsheetId: user.userSpreadsheetId ?? '',
    });
  } catch {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 400 });
  }
}
