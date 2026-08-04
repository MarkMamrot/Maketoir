import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

function getSession() {
  const pos = cookies().get('pos_session')?.value;
  const adm = cookies().get('marketoir_session')?.value;
  if (pos) try { return JSON.parse(pos); } catch {}
  if (adm) try { return JSON.parse(adm); } catch {}
  return null;
}

// Lazy one-time migration — adds to_location_id column if absent
let _dmColReady = false;
async function ensureDmColumn() {
  if (_dmColReady) return;
  // `ADD COLUMN IF NOT EXISTS` is unsupported on some MySQL versions, so check
  // information_schema first and only ALTER when the column is genuinely missing.
  try {
    const cols = await imsQuery<{ c: number }>(
      `SELECT COUNT(*) AS c FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'pos_chat_messages' AND column_name = 'to_location_id'`,
      [],
    );
    if (!cols[0]?.c) {
      await imsExecute('ALTER TABLE pos_chat_messages ADD COLUMN to_location_id INT NULL', []);
    }
    _dmColReady = true;
  } catch {
    // leave _dmColReady false so a later request retries
  }
}

// GET /api/pos/chat
//   ?type=group (default) — last 3 days of group messages
//   ?type=dm&to=<location_id> — DMs between my location and that location
export async function GET(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session', 'marketoir_session']);

  await ensureDmColumn();

  const url  = new URL(req.url);
  const type = url.searchParams.get('type') ?? 'group';
  const toId = parseInt(url.searchParams.get('to') ?? '0', 10);
  const myId = parseInt(String(session.location_id ?? 0), 10);

  type Attachment = { id: number; message_id: number; original_name: string; mime_type: string; file_size: number };
  type Row = { id: number; location_id: number; location_name: string; user_name: string; avatar: string; message: string; to_location_id: number | null; created_at: string; attachments?: Attachment[] };

  let messages: Row[];
  if (type === 'dm' && toId > 0) {
    messages = await imsQuery<Row>(`
      SELECT id, location_id, location_name, user_name, avatar, message, to_location_id, created_at
      FROM pos_chat_messages
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 3 DAY)
        AND ((location_id = ? AND to_location_id = ?) OR (location_id = ? AND to_location_id = ?))
      ORDER BY created_at ASC LIMIT 200
    `, [myId, toId, toId, myId]);
  } else {
    messages = await imsQuery<Row>(`
      SELECT id, location_id, location_name, user_name, avatar, message, to_location_id, created_at
      FROM pos_chat_messages
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 3 DAY)
        AND (to_location_id IS NULL OR to_location_id = 0)
      ORDER BY created_at ASC LIMIT 200
    `, []);
  }

  if (messages.length > 0) {
    const messageIds = messages.map(message => Number(message.id));
    const attachments = await imsQuery<Attachment>(
      `SELECT id, message_id, original_name, mime_type, file_size
       FROM pos_chat_attachments WHERE message_id IN (${messageIds.map(() => '?').join(',')})
       ORDER BY id`,
      messageIds,
    ).catch(() => []);
    const byMessage = new Map<number, Attachment[]>();
    for (const attachment of attachments) {
      const list = byMessage.get(Number(attachment.message_id)) ?? [];
      list.push(attachment);
      byMessage.set(Number(attachment.message_id), list);
    }
    messages = messages.map(message => ({ ...message, attachments: byMessage.get(Number(message.id)) ?? [] }));
  }

  return NextResponse.json({ messages });
}

// POST /api/pos/chat — send a group message or DM
// Body: { message, avatar, to_location_id? }
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session', 'marketoir_session']);

  await ensureDmColumn();

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const message      = String(body.message ?? '').trim().slice(0, 500);
  if (!message) return NextResponse.json({ error: 'Message required.' }, { status: 400 });

  const locationId   = parseInt(String(session.location_id ?? 0), 10);
  const locationName = String(session.location_name ?? '');
  const userName     = String(session.full_name ?? session.username ?? 'Staff');
  const avatar       = String(body.avatar ?? '').replace(/[^a-zA-Z0-9_.\-]/g, '').slice(0, 100);
  const toLocationId = parseInt(String(body.to_location_id ?? 0), 10) || null;

  if (!locationId) return NextResponse.json({ error: 'No location in session.' }, { status: 400 });

  const result = await imsExecute(
    `INSERT INTO pos_chat_messages (location_id, location_name, user_name, avatar, message, to_location_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [locationId, locationName, userName, avatar, message, toLocationId],
  );
  return NextResponse.json({ success: true, id: result.insertId });
}
