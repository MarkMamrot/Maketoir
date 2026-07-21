import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';


export async function GET(req: Request) {
  if (!await getImsSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const from = (searchParams.get('from') ?? '').toUpperCase();
  const to   = (searchParams.get('to')   ?? 'AUD').toUpperCase();

  if (!from || from === to) {
    return NextResponse.json({ success: true, rate: 1 });
  }

  try {
    const res = await fetch(
      `https://api.frankfurter.app/latest?from=${from}&to=${to}`,
      { next: { revalidate: 3600 } } // cache 1 hour
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rate = data?.rates?.[to];
    if (rate == null) throw new Error('Rate not in response');
    return NextResponse.json({ success: true, rate: Number(rate), date: data.date });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 502 });
  }
}
