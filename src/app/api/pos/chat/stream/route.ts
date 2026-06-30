import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // seconds — Vercel/Railway limit for streaming

function getSession() {
  const pos = cookies().get('pos_session')?.value;
  const adm = cookies().get('marketoir_session')?.value;
  if (pos) try { return JSON.parse(pos); } catch {}
  if (adm) try { return JSON.parse(adm); } catch {}
  return null;
}

// GET /api/pos/chat/stream?since=<lastMessageId>
// SSE long-poll: holds connection up to ~25s, sends new messages as they arrive.
// Client reconnects automatically (EventSource).
export async function GET(req: Request) {
  const session = getSession();
  if (!session) return new Response('Unauthorised', { status: 401 });

  const url = new URL(req.url);
  let since = parseInt(url.searchParams.get('since') ?? '0', 10) || 0;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        try { controller.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch {}
      };

      // Helper: fetch messages newer than `since`
      async function fetchNew() {
        try {
          const rows = await imsQuery<{
            id: number; location_id: number; location_name: string;
            user_name: string; avatar: string; message: string; created_at: string;
          }>(
            `SELECT id, location_id, location_name, user_name, avatar, message, created_at
             FROM pos_chat_messages
             WHERE id > ?
               AND created_at >= DATE_SUB(NOW(), INTERVAL 3 DAY)
             ORDER BY created_at ASC
             LIMIT 50`,
            [since],
          );
          return rows;
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
