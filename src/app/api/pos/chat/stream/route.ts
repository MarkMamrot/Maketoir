import { imsQuery } from '@/services/IMSMySQLService';
import { getImsDbNameStrict } from '@/lib/db/BusinessRegistry';
import { resolveChatIdentity } from '../_identity';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // seconds — Vercel/Railway limit for streaming

// GET /api/pos/chat/stream?since=<lastMessageId>
// SSE long-poll: holds connection up to ~25s, sends new messages as they arrive.
// Client reconnects automatically (EventSource).
export async function GET(req: Request) {
  const identity = await resolveChatIdentity();
  if (!identity) return new Response('No active chat location is configured', { status: 403 });
  // The SSE poll runs in detached timer callbacks — resolve the tenant schema
  // up front and pass it explicitly to every query.
  const imsDb = await getImsDbNameStrict(identity.businessId);
  if (!imsDb) return new Response('Unauthorised', { status: 401 });

  const url = new URL(req.url);
  let since = parseInt(url.searchParams.get('since') ?? '0', 10) || 0;
  const myLocId = identity.locationId;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        try { controller.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch {}
      };

      // Helper: fetch messages newer than `since` — group + DMs involving this location
      async function fetchNew() {
        try {
          const rows = await imsQuery<{
            id: number; location_id: number; location_name: string;
            user_name: string; avatar: string; message: string;
            to_location_id: number | null; created_at: string; attachments?: any[];
          }>(
            `SELECT id, location_id, location_name, user_name, avatar, message, to_location_id, created_at
             FROM pos_chat_messages
             WHERE id > ?
               AND created_at >= DATE_SUB(NOW(), INTERVAL 3 DAY)
               AND (
                 (to_location_id IS NULL OR to_location_id = 0)
                 OR location_id = ?
                 OR to_location_id = ?
               )
             ORDER BY created_at ASC
             LIMIT 50`,
            [since, myLocId, myLocId],
            imsDb,
          );
          if (rows.length === 0) return rows;
          const messageIds = rows.map(row => Number(row.id));
          const attachments = await imsQuery<{
            id: number; message_id: number; original_name: string; mime_type: string; file_size: number;
          }>(
            `SELECT id, message_id, original_name, mime_type, file_size
             FROM pos_chat_attachments WHERE message_id IN (${messageIds.map(() => '?').join(',')})
             ORDER BY id`,
            messageIds,
            imsDb,
          ).catch(() => []);
          return rows.map(row => ({ ...row, attachments: attachments.filter(file => Number(file.message_id) === Number(row.id)) }));
        } catch { return []; }
      }

      // 1. Send any messages already newer than `since` immediately
      const initial = await fetchNew();
      if (initial.length > 0) {
        send(JSON.stringify({ messages: initial }));
        since = Math.max(...initial.map(m => m.id));
      } else {
        // Send a keep-alive comment so the client knows the connection is live
        try { controller.enqueue(encoder.encode(': keep-alive\n\n')); } catch {}
      }

      // 2. Poll every 1.5s for up to 25s, sending any new messages immediately
      const pollInterval = 1500;
      const maxWait = 25_000;
      const startTime = Date.now();

      await new Promise<void>(resolve => {
        const timer = setInterval(async () => {
          const elapsed = Date.now() - startTime;
          if (elapsed >= maxWait) { clearInterval(timer); resolve(); return; }

          const rows = await fetchNew();
          if (rows.length > 0) {
            send(JSON.stringify({ messages: rows }));
            since = Math.max(...rows.map(m => m.id));
          }
        }, pollInterval);
      });

      try { controller.close(); } catch {}
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
