import { cookies } from 'next/headers';
import mysql from 'mysql2/promise';

export function getImportSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function getLegacyConn(businessId: string) {
  const conn = await mysql.createConnection({
    host:           process.env.MYSQL_HOST     ?? 'localhost',
    port:           parseInt(process.env.MYSQL_PORT ?? '3306', 10),
    database:       process.env.MYSQL_DATABASE ?? '',
    user:           process.env.MYSQL_USER     ?? '',
    password:       process.env.MYSQL_PASSWORD ?? '',
    connectTimeout: 20000,
    timezone:       'Z',
    charset:        'utf8mb4',
  });
  return conn;
}

export function makeSSEStream(run: (send: (d: object) => void) => Promise<void>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await run(send);
      } catch (e: any) {
        send({ status: 'error', message: e.message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  });
}
