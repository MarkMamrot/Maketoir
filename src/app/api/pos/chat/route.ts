import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';

function getSession() {
  const pos = cookies().get('pos_session')?.value;
  const adm = cookies().get('marketoir_session')?.value;
  if (pos) try { return JSON.parse(pos); } catch {}
  if (adm) try { return JSON.parse(adm); } catch {}
  return null;
}

// GET /api/pos/chat — last 3 days of chat messages
export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  const messages = await imsQuery<{
    id: number;
    location_id: number;
    location_name: string;
    user_name: string;
    avatar: string;
    message: string;
    created_at: string;
  }>(`
    SELECT id, location_id, location_name, user_name, avatar, message, created_at
    FROM pos_chat_messages
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 3 DAY)
    ORDER BY created_at ASC
    LIMIT 200
  `, []);

  return NextResponse.json({ messages });
}

// POST /api/pos/chat — send a message
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const message = String(body.message ?? '').trim().slice(0, 500);
  if (!message) return NextResponse.json({ error: 'Message required.' }, { status: 400 });

  const locationId   = parseInt(String(session.location_id ?? 0), 10);
  const locationName = String(session.location_name ?? '');
  const userName     = String(session.full_name ?? session.username ?? 'Staff');
  const avatar       = String(body.avatar ?? '').replace(/[^a-zA-Z0-9_.\-]/g, '').slice(0, 100);

  if (!locationId) return NextResponse.json({ error: 'No location in session.' }, { status: 400 });

  await imsExecute(
    `INSERT INTO pos_chat_messages (location_id, location_name, user_name, avatar, message)
     VALUES (?, ?, ?, ?, ?)`,
    [locationId, locationName, userName, avatar, message],
  );

  const idRows = await imsQuery<{ id: number }>('SELECT LAST_INSERT_ID() AS id', []);
  return NextResponse.json({ success: true, id: idRows[0]?.id ?? null });
}
