import { NextResponse } from 'next/server';
import { ConfigRepository } from '@/lib/db/ConfigRepository';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';

const CONFIG_KEY = 'volume_calibration';

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId')?.trim() ?? '';
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  try {
    const raw = await ConfigRepository.get(databaseId, CONFIG_KEY);
    const calibration: Record<string, string> = raw ? JSON.parse(raw) : {};
    return NextResponse.json({ success: true, calibration });
  } catch {
    return NextResponse.json({ success: true, calibration: {} });
  }
}

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const body = await req.json();
  const databaseId: string = String(body?.databaseId ?? '').trim();
  const calibration: Record<string, string> = body?.calibration ?? {};

  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  try {
    await ConfigRepository.set(databaseId, CONFIG_KEY, JSON.stringify(calibration));
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `Failed to save calibration: ${e.message}` }, { status: 500 });
  }
}
