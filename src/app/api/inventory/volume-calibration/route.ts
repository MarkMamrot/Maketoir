import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ConfigRepository } from '@/lib/db/ConfigRepository';

const CONFIG_KEY = 'volume_calibration';

export async function GET(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId')?.trim() ?? '';
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });

  try {
    const raw = await ConfigRepository.get(databaseId, CONFIG_KEY);
    const calibration: Record<string, string> = raw ? JSON.parse(raw) : {};
    return NextResponse.json({ success: true, calibration });
  } catch {
    return NextResponse.json({ success: true, calibration: {} });
  }
}

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });

  const body = await req.json();
  const databaseId: string = String(body?.databaseId ?? '').trim();
  const calibration: Record<string, string> = body?.calibration ?? {};

  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });

  try {
    await ConfigRepository.set(databaseId, CONFIG_KEY, JSON.stringify(calibration));
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `Failed to save calibration: ${e.message}` }, { status: 500 });
  }
}
