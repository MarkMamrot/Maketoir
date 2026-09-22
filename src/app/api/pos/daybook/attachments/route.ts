import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { resolveContext } from '../route';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_COMMUNICATION = 3;
const ALLOWED_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

function uploadDirectory(businessId: string, communicationId: number): string {
  return path.join(process.env.UPLOAD_BASE_PATH ?? './uploads', businessId, 'DaybookCommunications', String(communicationId));
}

// POST /api/pos/daybook/attachments — attach a JPG/PNG/WebP/PDF to a Store Daybook communication.
export async function POST(req: Request) {
  let storedPath = '';
  let businessId = '';
  let communicationId = 0;
  try {
    const form = await req.formData();
    const locationOverride = Number(form.get('location_id') ?? 0);
    const context = await resolveContext(locationOverride || undefined);
    if (!context) return NextResponse.json({ error: 'An active POS location is required.' }, { status: 401 });
    businessId = context.businessId;
    communicationId = Number(form.get('communication_id'));
    const file = form.get('file');
    if (!communicationId || !(file instanceof File)) {
      return NextResponse.json({ error: 'communication_id and file are required.' }, { status: 400 });
    }
    const rows = await imsQuery<{ id: number }>(
      `SELECT c.id FROM pos_daybook_communications c
       JOIN pos_daybook_communication_targets t ON t.business_id = c.business_id AND t.communication_id = c.id
       WHERE c.id = ? AND c.business_id = ? AND t.location_id = ? AND c.archived_at IS NULL LIMIT 1`,
      [communicationId, businessId, context.locationId],
    );
    if (!rows[0]) return NextResponse.json({ error: 'Communication not found.' }, { status: 404 });
    const countRows = await imsQuery<{ count: number }>(
      'SELECT COUNT(*) AS count FROM pos_daybook_communication_attachments WHERE business_id = ? AND communication_id = ?',
      [businessId, communicationId],
    );
    if (Number(countRows[0]?.count ?? 0) >= MAX_FILES_PER_COMMUNICATION) {
      return NextResponse.json({ error: 'A communication can have up to 3 attachments.' }, { status: 400 });
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
    const directory = uploadDirectory(businessId, communicationId);
    await fs.mkdir(directory, { recursive: true });
    storedPath = path.join(directory, storedName);
    await fs.writeFile(storedPath, Buffer.from(await file.arrayBuffer()), { flag: 'wx' });
    const originalName = path.basename(file.name).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 255) || `attachment${expectedExtension}`;
    const result = await imsExecute(
      `INSERT INTO pos_daybook_communication_attachments (business_id, communication_id, original_name, stored_name, mime_type, file_size)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [businessId, communicationId, originalName, storedName, file.type, file.size],
    );
    return NextResponse.json({ success: true, attachment: { id: result.insertId, communication_id: communicationId, original_name: originalName, mime_type: file.type, file_size: file.size } });
  } catch (error: any) {
    if (storedPath) await fs.unlink(storedPath).catch(() => {});
    await reportRuntimeIssue({ businessId: businessId || undefined, source: 'pos.daybook', operation: 'upload-attachment', title: 'Store Daybook attachment upload failed', error, context: { communicationId } });
    return NextResponse.json({ error: error.message ?? 'Attachment upload failed.' }, { status: 500 });
  }
}
