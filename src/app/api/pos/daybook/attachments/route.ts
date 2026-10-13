import crypto from 'crypto';
import path from 'path';
import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { canEditDaybookItem, normalizeDaybookEditPolicy, normalizeStaffIdentity } from '@/lib/pos/daybookService';
import { getIMSPool, imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { resolveContext, type DaybookContext } from '../route';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_COMMUNICATION = 3;
const ALLOWED_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

function fileError(file: File): string | null {
  const expectedExtension = ALLOWED_TYPES.get(file.type);
  const suppliedExtension = path.extname(file.name).toLowerCase();
  if (!expectedExtension || (file.type === 'image/jpeg' ? !['.jpg', '.jpeg'].includes(suppliedExtension) : suppliedExtension !== expectedExtension)) {
    return 'Only JPG, PNG, WebP and PDF files are allowed.';
  }
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) return 'Each attachment must be between 1 byte and 10 MB.';
  return null;
}

async function checkEditAccess(form: FormData, context: DaybookContext, communicationId: number) {
  const rows = await imsQuery<{ id: number; author_user_id: number | null; author_staff_identity_id: number | null; author_staff_initials: string | null }>(
    `SELECT c.id, c.author_user_id, c.author_staff_identity_id, c.author_staff_initials FROM pos_daybook_communications c
     JOIN pos_daybook_communication_targets t ON t.business_id = c.business_id AND t.communication_id = c.id
     WHERE c.id = ? AND c.business_id = ? AND t.location_id = ? AND c.archived_at IS NULL LIMIT 1`,
    [communicationId, context.businessId, context.locationId],
  );
  const communication = rows[0];
  if (!communication) return NextResponse.json({ error: 'Communication not found.' }, { status: 404 });
  let staff;
  try {
    staff = normalizeStaffIdentity({ id: Number(form.get('staff_identity_id')) || null, name: String(form.get('staff_name') ?? ''), initials: String(form.get('staff_initials') ?? '') });
  } catch {
    return NextResponse.json({ error: 'Choose your staff identity first.' }, { status: 400 });
  }
  const settings = await imsQuery<{ value: string }>(
    "SELECT value FROM ims_settings WHERE business_id = ? AND `key` = 'pos_daybook_edit_policy' LIMIT 1",
    [context.businessId],
  );
  if (!canEditDaybookItem({ policy: normalizeDaybookEditPolicy(settings[0]?.value), isManager: context.isManager,
    actorUserId: context.actorUserId, staffIdentityId: staff.id ?? null, staffInitials: staff.initials,
    authorUserId: Number(communication.author_user_id) || null, authorStaffIdentityId: Number(communication.author_staff_identity_id) || null,
    authorStaffInitials: String(communication.author_staff_initials ?? '') })) {
    return NextResponse.json({ error: 'You do not have permission to edit this communication.' }, { status: 403 });
  }
  return null;
}

// POST /api/pos/daybook/attachments — attach a JPG/PNG/WebP/PDF to a Store Daybook communication.
export async function POST(req: Request) {
  let businessId = '';
  let communicationId = 0;
  try {
    const form = await req.formData();
    const locationOverride = Number(form.get('location_id') ?? 0);
    const context = await resolveContext(locationOverride || undefined);
    if (!context) return NextResponse.json({ error: 'An active POS location is required.' }, { status: 401 });
    businessId = context.businessId;
    return await runImsForBusiness(businessId, async () => {
    communicationId = Number(form.get('communication_id'));
    const file = form.get('file');
    if (!communicationId || !(file instanceof File)) {
      return NextResponse.json({ error: 'communication_id and file are required.' }, { status: 400 });
    }
    const denied = await checkEditAccess(form, context, communicationId);
    if (denied) return denied;
    const countRows = await imsQuery<{ count: number }>(
      'SELECT COUNT(*) AS count FROM pos_daybook_communication_attachments WHERE business_id = ? AND communication_id = ?',
      [businessId, communicationId],
    );
    if (Number(countRows[0]?.count ?? 0) >= MAX_FILES_PER_COMMUNICATION) {
      return NextResponse.json({ error: 'A communication can have up to 3 attachments.' }, { status: 400 });
    }
    const invalidFile = fileError(file);
    if (invalidFile) return NextResponse.json({ error: invalidFile }, { status: 400 });

    const storedName = `${crypto.randomUUID()}${ALLOWED_TYPES.get(file.type)}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const originalName = path.basename(file.name).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 255) || `attachment${ALLOWED_TYPES.get(file.type)}`;
    const result = await imsExecute(
      `INSERT INTO pos_daybook_communication_attachments (business_id, communication_id, original_name, stored_name, mime_type, file_size, file_content)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [businessId, communicationId, originalName, storedName, file.type, file.size, bytes],
    );
    return NextResponse.json({ success: true, attachment: { id: result.insertId, communication_id: communicationId, original_name: originalName, mime_type: file.type, file_size: file.size } });
    });
  } catch (error: any) {
    await reportRuntimeIssue({ businessId: businessId || undefined, source: 'pos.daybook', operation: 'upload-attachment', title: 'Store Daybook attachment upload failed', error, context: { communicationId } });
    return NextResponse.json({ error: error.message ?? 'Attachment upload failed.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  let businessId = '';
  let communicationId = 0;
  try {
    const form = await req.formData();
    const context = await resolveContext(Number(form.get('location_id')) || undefined);
    if (!context) return NextResponse.json({ error: 'An active POS location is required.' }, { status: 401 });
    businessId = context.businessId;
    communicationId = Number(form.get('communication_id'));
    if (!Number.isSafeInteger(communicationId) || communicationId <= 0) return NextResponse.json({ error: 'Invalid communication.' }, { status: 400 });
    let retainedIds: number[];
    let originalIds: number[];
    try {
      const parsed = JSON.parse(String(form.get('retained_attachment_ids') ?? '[]'));
      const original = JSON.parse(String(form.get('original_attachment_ids') ?? '[]'));
      if ([parsed, original].some(ids => !Array.isArray(ids) || ids.length > 3 || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length)) throw new Error('Invalid attachments');
      retainedIds = parsed;
      originalIds = original;
    } catch {
      return NextResponse.json({ error: 'Invalid attachment selection.' }, { status: 400 });
    }
    const files = form.getAll('files');
    if (files.length + retainedIds.length > MAX_FILES_PER_COMMUNICATION) return NextResponse.json({ error: 'A communication can have up to 3 attachments.' }, { status: 400 });
    const uploads = [];
    for (const file of files) {
      if (!(file instanceof File)) return NextResponse.json({ error: 'Invalid attachment.' }, { status: 400 });
      const invalidFile = fileError(file);
      if (invalidFile) return NextResponse.json({ error: invalidFile }, { status: 400 });
      uploads.push({ originalName: path.basename(file.name).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 255),
        storedName: `${crypto.randomUUID()}${ALLOWED_TYPES.get(file.type)}`, mimeType: file.type, size: file.size, bytes: Buffer.from(await file.arrayBuffer()) });
    }
    return await runImsForBusiness(businessId, async () => {
      const denied = await checkEditAccess(form, context, communicationId);
      if (denied) return denied;
      const connection = await getIMSPool().getConnection();
      try {
        await connection.beginTransaction();
        const [communications] = await connection.query<any[]>(
          'SELECT id FROM pos_daybook_communications WHERE id = ? AND business_id = ? AND archived_at IS NULL FOR UPDATE',
          [communicationId, businessId],
        );
        if (!communications.length) {
          await connection.rollback();
          return NextResponse.json({ error: 'Communication not found.' }, { status: 404 });
        }
        const [existing] = await connection.query<any[]>(
          'SELECT id FROM pos_daybook_communication_attachments WHERE business_id = ? AND communication_id = ? FOR UPDATE',
          [businessId, communicationId],
        );
        if (existing.length !== originalIds.length || originalIds.some(id => !existing.some(attachment => Number(attachment.id) === id))
          || retainedIds.some(id => !originalIds.includes(id))) {
          await connection.rollback();
          return NextResponse.json({ error: 'Attachments have changed. Reload the communication and try again.' }, { status: 409 });
        }
        await connection.execute(
          `DELETE FROM pos_daybook_communication_attachments WHERE business_id = ? AND communication_id = ?${retainedIds.length ? ` AND id NOT IN (${retainedIds.map(() => '?').join(',')})` : ''}`,
          [businessId, communicationId, ...retainedIds],
        );
        for (const upload of uploads) {
          await connection.execute(
            `INSERT INTO pos_daybook_communication_attachments (business_id, communication_id, original_name, stored_name, mime_type, file_size, file_content)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [businessId, communicationId, upload.originalName, upload.storedName, upload.mimeType, upload.size, upload.bytes],
          );
        }
        await connection.commit();
        return NextResponse.json({ success: true });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    });
  } catch (error) {
    await reportRuntimeIssue({ businessId: businessId || undefined, source: 'pos.daybook', operation: 'replace-attachments', title: 'Store Daybook attachment changes failed', error, context: { communicationId } });
    return NextResponse.json({ error: 'Attachment changes could not be saved. Existing attachments were kept.' }, { status: 500 });
  }
}
