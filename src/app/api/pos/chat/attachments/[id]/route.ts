import fs from 'fs/promises';
import path from 'path';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';
import { resolveChatIdentity } from '../../_identity';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const identity = await resolveChatIdentity(new URL(req.url).searchParams.get('surface') === 'ims' ? 'ims' : 'auto');
  if (!identity) return new Response('No active chat location is configured', { status: 403 });
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
    const isGroup = !attachment.to_location_id;
    const canRead = isGroup || identity.locationId === Number(attachment.location_id) || identity.locationId === Number(attachment.to_location_id);
    if (!canRead) return new Response('Forbidden', { status: 403 });
    const safeStoredName = path.basename(attachment.stored_name);
    if (safeStoredName !== attachment.stored_name) return new Response('Invalid attachment', { status: 400 });
    const filePath = path.join(process.env.UPLOAD_BASE_PATH ?? './uploads', identity.businessId, 'POSChat', String((await imsQuery<{ message_id: number }>('SELECT message_id FROM pos_chat_attachments WHERE id = ? LIMIT 1', [attachmentId]))[0].message_id), safeStoredName);
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
    await reportRuntimeIssue({ businessId: identity.businessId, source: 'pos.chat', operation: 'download-attachment', title: 'POS chat attachment download failed', error, context: { attachmentId } });
    return new Response('Attachment download failed', { status: 500 });
  }
}
