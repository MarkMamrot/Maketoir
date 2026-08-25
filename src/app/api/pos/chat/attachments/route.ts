import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { resolveChatIdentity } from '../_identity';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_MESSAGE = 3;
const ALLOWED_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

function uploadDirectory(businessId: string, messageId: number): string {
  return path.join(process.env.UPLOAD_BASE_PATH ?? './uploads', businessId, 'POSChat', String(messageId));
}

export async function POST(req: Request) {
  const identity = await resolveChatIdentity();
  if (!identity) return NextResponse.json({ error: 'No active chat location is configured.' }, { status: 403 });

  let messageId = 0;
  let storedPath = '';
  try {
    const form = await req.formData();
    messageId = Number(form.get('message_id'));
    const file = form.get('file');
    if (!messageId || !(file instanceof File)) {
      return NextResponse.json({ error: 'message_id and file are required.' }, { status: 400 });
    }
    const messageRows = await imsQuery<{ location_id: number }>(
      'SELECT location_id FROM pos_chat_messages WHERE id = ? LIMIT 1',
      [messageId],
    );
    if (!messageRows.length) return NextResponse.json({ error: 'Message not found.' }, { status: 404 });
    if (Number(messageRows[0].location_id) !== identity.locationId) {
      return NextResponse.json({ error: 'Only the message sender can add attachments.' }, { status: 403 });
    }
    const countRows = await imsQuery<{ count: number }>(
      'SELECT COUNT(*) AS count FROM pos_chat_attachments WHERE message_id = ?',
      [messageId],
    );
    if (Number(countRows[0]?.count ?? 0) >= MAX_FILES_PER_MESSAGE) {
      return NextResponse.json({ error: 'A message can have up to 3 attachments.' }, { status: 400 });
    }
    const expectedExtension = ALLOWED_TYPES.get(file.type);
    const suppliedExtension = path.extname(file.name).toLowerCase();
    if (!expectedExtension || (file.type === 'image/jpeg' ? !['.jpg', '.jpeg'].includes(suppliedExtension) : suppliedExtension !== expectedExtension)) {
      return NextResponse.json({ error: 'Only JPG, PNG, WebP and PDF files are allowed.' }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'Each attachment must be no larger than 10 MB.' }, { status: 400 });
    }

    const storedName = `${crypto.randomUUID()}${expectedExtension}`;
    const directory = uploadDirectory(identity.businessId, messageId);
    await fs.mkdir(directory, { recursive: true });
    storedPath = path.join(directory, storedName);
    await fs.writeFile(storedPath, Buffer.from(await file.arrayBuffer()), { flag: 'wx' });
    const originalName = path.basename(file.name).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 255) || `attachment${expectedExtension}`;
    const result = await imsExecute(
      `INSERT INTO pos_chat_attachments (message_id, original_name, stored_name, mime_type, file_size)
       VALUES (?, ?, ?, ?, ?)`,
      [messageId, originalName, storedName, file.type, file.size],
    );
    return NextResponse.json({ success: true, attachment: { id: result.insertId, message_id: messageId, original_name: originalName, mime_type: file.type, file_size: file.size } });
  } catch (error: any) {
    if (storedPath) await fs.unlink(storedPath).catch(() => {});
    await reportRuntimeIssue({ businessId: identity.businessId, source: 'pos.chat', operation: 'upload-attachment', title: 'POS chat attachment upload failed', error, context: { messageId } });
    return NextResponse.json({ error: error.message ?? 'Attachment upload failed.' }, { status: 500 });
  }
}
