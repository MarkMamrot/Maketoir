import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return NextResponse.json({ session: null });
  try {
    const session = JSON.parse(raw);
    return NextResponse.json({ session });
  } catch {
    return NextResponse.json({ session: null });
  }
}
