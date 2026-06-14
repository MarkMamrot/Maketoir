import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ConnectionsRepository, CONNECTION_SECRET_FIELDS } from '@/lib/db/ConnectionsRepository';
import { encrypt, decrypt } from '@/lib/encryption';

function requireSession() {
  const session = cookies().get('marketoir_session');
  if (!session) return null;
  try { return JSON.parse(session.value); } catch { return null; }
}

/**
 * GET /api/user/business-connections?databaseId=xxx
 */
export async function GET(req: Request) {
  const user = requireSession();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  if (!databaseId || databaseId !== user.userSpreadsheetId) {
    return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });
  }

  try {
    const raw = await ConnectionsRepository.getLegacy(databaseId);
    // Decrypt secret fields before returning to frontend
    const data: Record<string, string> = {};
    for (const [key, val] of Object.entries(raw)) {
      data[key] = CONNECTION_SECRET_FIELDS.has(key) ? decrypt(val) : val;
    }
    return NextResponse.json({ success: true, connections: data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/user/business-connections
 * Body: { databaseId: string, connections: { ShopifyShopId, ShopifyAccessToken, ... } }
 */
export async function POST(req: Request) {
  const user = requireSession();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const { databaseId, connections } = await req.json();
  if (!databaseId || databaseId !== user.userSpreadsheetId) {
    return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });
  }

  try {
    // Encrypt secret fields before storing
    const toSave: Record<string, string> = {};
    for (const [key, val] of Object.entries(connections as Record<string, string>)) {
      toSave[key] = CONNECTION_SECRET_FIELDS.has(key) ? encrypt(val ?? '') : (val ?? '');
    }
    await ConnectionsRepository.saveFromLegacy(databaseId, toSave);
    return NextResponse.json({ success: true, message: 'Connection settings saved.' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
