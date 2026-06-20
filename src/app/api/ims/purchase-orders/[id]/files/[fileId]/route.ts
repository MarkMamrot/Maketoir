import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import fs from 'fs';
import path from 'path';
import { ImsPORepo, ImsPoFilesRepo } from '@/lib/ims/ImsRepository';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

function getUploadDir(businessId: string, poNumber: string): string {
  const base = process.env.UPLOAD_BASE_PATH ?? './uploads';
  const safePoNumber = poNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(base, businessId, 'POs', safePoNumber);
}

/**
 * GET /api/ims/purchase-orders/[id]/files/[fileId]
 * Streams the file to the client.
 */
export async function GET(
  _: Request,
  { params }: { params: { id: string; fileId: string } },
) {
  const session = getSession();
  if (!session) return new Response('Not authenticated', { status: 401 });

  const fileId = Number(params.fileId);
  if (isNaN(fileId)) return new Response('Invalid file id', { status: 400 });

  const record = await ImsPoFilesRepo.get(fileId).catch(() => null);
  if (!record) return new Response('File not found', { status: 404 });

  // Ownership check
  if (record.business_id !== session.userSpreadsheetId) {
    return new Response('Forbidden', { status: 403 });
  }

  const po = await ImsPORepo.get(record.po_id).catch(() => null);
  if (!po) return new Response('PO not found', { status: 404 });

  const filePath = path.join(getUploadDir(record.business_id, po.po_number), record.filename);

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
 * DELETE /api/ims/purchase-orders/[id]/files/[fileId]
 * Removes the file from disk and the database.
 */
export async function DELETE(
  _: Request,
  { params }: { params: { id: string; fileId: string } },
) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const fileId = Number(params.fileId);
  if (isNaN(fileId)) return NextResponse.json({ error: 'Invalid file id' }, { status: 400 });

  const record = await ImsPoFilesRepo.get(fileId).catch(() => null);
  if (!record) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  if (record.business_id !== session.userSpreadsheetId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const po = await ImsPORepo.get(record.po_id).catch(() => null);
  if (po) {
    const filePath = path.join(getUploadDir(record.business_id, po.po_number), record.filename);
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  }

  await ImsPoFilesRepo.delete(fileId);

  const files = await ImsPoFilesRepo.list(record.po_id);
  return NextResponse.json({ success: true, files });
}
