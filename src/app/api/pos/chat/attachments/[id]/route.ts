import fs from 'fs/promises';
import path from 'path';
import { cookies } from 'next/headers';

import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

function readSession(): any | null {
  for (const name of ['pos_session', 'marketoir_session']) {
    const raw = cookies().get(name)?.value;
    if (!raw) continue;
    try { return { ...JSON.parse(raw), cookieName: name }; } catch {}
  }
  return null;
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const rawSession = readSession();
  if (!rawSession) return new Response('Unauthorised', { status: 401 });
  const session = await getImsSession(['pos_session', 'marketoir_session']);
  if (!session) return new Response('Unauthorised', { status: 401 });
  const attachmentId = Number(params.id);
  if (!attachmentId) return new Response('Invalid attachment', { status: 400 });

  try {
    const rows = await imsQuery<{
      original_name: string; stored_name: string; mime_type: string;
      location_id: number; to_location_id: number | null;
    }>(
      `SELECT a.original_name, a.stored_name, a.mime_type, m.location_id, m.to_location_id
       FROM pos_chat_attachments a
       JOIN pos_chat_messages m ON m.id = a.message_id
       WHERE a.id = ? LIMIT 1`,
      [attachmentId],
    );
    const attachment = rows[0];
    if (!attachment) return new Response('Not found', { status: 404 });
    if (rawSession.cookieName === 'pos_session') {
      const locationId = Number(rawSession.location_id ?? 0);
      const isGroup = !attachment.to_location_id;
      const canRead = isGroup || locationId === Number(attachment.location_id) || locationId === Number(attachment.to_location_id);
      if (!canRead) return new Response('Forbidden', { status: 403 });
    }
    const safeStoredName = path.basename(attachment.stored_name);
    if (safeStoredName !== attachment.stored_name) return new Response('Invalid attachment', { status: 400 });
    const filePath = path.join(process.env.UPLOAD_BASE_PATH ?? './uploads', session.businessId, 'POSChat', String((await imsQuery<{ message_id: number }>('SELECT message_id FROM pos_chat_attachments WHERE id = ? LIMIT 1', [attachmentId]))[0].message_id), safeStoredName);
    const bytes = await fs.readFile(filePath);
    const safeDownloadName = attachment.original_name.replace(/["\r\n]/g, '_');
    return new Response(bytes, {
      headers: {
        'Content-Type': attachment.mime_type,
        'Content-Disposition': `inline; filename="${safeDownloadName}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error: any) {
    if (error?.code === 'ENOENT') return new Response('File not found', { status: 404 });
    await reportRuntimeIssue({ businessId: session.businessId, source: 'pos.chat', operation: 'download-attachment', title: 'POS chat attachment download failed', error, context: { attachmentId } });
    return new Response('Attachment download failed', { status: 500 });
  }
}
