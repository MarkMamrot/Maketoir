import fs from 'fs/promises';
import path from 'path';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';
import { resolveContext } from '../../route';

// GET /api/pos/daybook/attachments/[id]?location_id=X — download a communication attachment.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const url = new URL(req.url);
  const locationOverride = Number(url.searchParams.get('location_id') ?? 0);
  const context = await resolveContext(locationOverride || undefined);
  if (!context) return new Response('An active POS location is required.', { status: 401 });
  const attachmentId = Number(params.id);
  if (!attachmentId) return new Response('Invalid attachment.', { status: 400 });

  try {
    const rows = await imsQuery<{ original_name: string; stored_name: string; mime_type: string; communication_id: number }>(
      `SELECT a.original_name, a.stored_name, a.mime_type, a.communication_id
       FROM pos_daybook_communication_attachments a
       JOIN pos_daybook_communications c ON c.id = a.communication_id AND c.business_id = a.business_id
       JOIN pos_daybook_communication_targets t ON t.business_id = c.business_id AND t.communication_id = c.id
       WHERE a.id = ? AND a.business_id = ? AND t.location_id = ? AND c.archived_at IS NULL LIMIT 1`,
      [attachmentId, context.businessId, context.locationId],
    );
    const attachment = rows[0];
    if (!attachment) return new Response('Not found.', { status: 404 });
    const safeStoredName = path.basename(attachment.stored_name);
    if (safeStoredName !== attachment.stored_name) return new Response('Invalid attachment.', { status: 400 });
    const filePath = path.join(process.env.UPLOAD_BASE_PATH ?? './uploads', context.businessId, 'DaybookCommunications', String(attachment.communication_id), safeStoredName);
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
    if (error?.code === 'ENOENT') return new Response('File not found.', { status: 404 });
    await reportRuntimeIssue({ businessId: context.businessId, source: 'pos.daybook', operation: 'download-attachment', title: 'Store Daybook attachment download failed', error, context: { attachmentId } });
    return new Response('Attachment download failed.', { status: 500 });
  }
}
