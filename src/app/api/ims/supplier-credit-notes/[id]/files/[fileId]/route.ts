import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import fs from 'fs';
import path from 'path';
import { ImsSupplierCNRepo, ImsSupplierCNFilesRepo } from '@/lib/ims/ImsRepository';

function getUploadDir(businessId: string, scnNumber: string): string {
  const base = process.env.UPLOAD_BASE_PATH ?? './uploads';
  const safeScnNumber = scnNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(base, businessId, 'SCNs', safeScnNumber);
}

/**
 * GET /api/ims/supplier-credit-notes/[id]/files/[fileId]
 * Streams the file to the client.
 */
export async function GET(
  _: Request,
  { params }: { params: { id: string; fileId: string } },
) {
  const session = await getImsSession();
  if (!session) return new Response('Not authenticated', { status: 401 });

  const fileId = Number(params.fileId);
  if (isNaN(fileId)) return new Response('Invalid file id', { status: 400 });

  const record = await ImsSupplierCNFilesRepo.get(fileId, session.businessId).catch(() => null);
  if (!record) return new Response('File not found', { status: 404 });

  if (record.business_id !== session.businessId) {
    return new Response('Forbidden', { status: 403 });
  }

  const scn = await ImsSupplierCNRepo.get(record.scn_id, session.businessId).catch(() => null);
  if (!scn) return new Response('Supplier credit note not found', { status: 404 });

  const filePath = path.join(getUploadDir(record.business_id, scn.scn_number), record.filename);

  if (!fs.existsSync(filePath)) {
    return new Response('File not found on disk', { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  const safeOriginalName = record.original_name.replace(/[^\w.\- ]/g, '_');

  return new Response(buffer, {
    headers: {
      'Content-Type': record.mime_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${safeOriginalName}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

/**
 * DELETE /api/ims/supplier-credit-notes/[id]/files/[fileId]
 * Removes the file from disk and the database.
 */
export async function DELETE(
  _: Request,
  { params }: { params: { id: string; fileId: string } },
) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const fileId = Number(params.fileId);
  if (isNaN(fileId)) return NextResponse.json({ error: 'Invalid file id' }, { status: 400 });

  const record = await ImsSupplierCNFilesRepo.get(fileId, session.businessId).catch(() => null);
  if (!record) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  if (record.business_id !== session.businessId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const scn = await ImsSupplierCNRepo.get(record.scn_id, session.businessId).catch(() => null);
  if (scn) {
    const filePath = path.join(getUploadDir(record.business_id, scn.scn_number), record.filename);
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  }

  await ImsSupplierCNFilesRepo.delete(fileId, session.businessId);

  const files = await ImsSupplierCNFilesRepo.list(record.scn_id, session.businessId);
  return NextResponse.json({ success: true, files });
}
