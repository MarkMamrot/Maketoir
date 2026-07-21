import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import fs from 'fs';
import path from 'path';
import { ImsPORepo, ImsPoFilesRepo } from '@/lib/ims/ImsRepository';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const EXT_MAP: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};


function getUploadDir(businessId: string, poNumber: string): string {
  const base = process.env.UPLOAD_BASE_PATH ?? './uploads';
  // Sanitize poNumber for use as a directory name
  const safePoNumber = poNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(base, businessId, 'POs', safePoNumber);
}

/**
 * POST /api/ims/purchase-orders/[id]/files
 * Body: multipart/form-data { file: File }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const poId = Number(params.id);
  if (isNaN(poId)) return NextResponse.json({ error: 'Invalid PO id' }, { status: 400 });

  // Fetch PO to verify it exists and get po_number for folder path
  const po = await ImsPORepo.get(poId, session.businessId).catch(() => null);
  if (!po) return NextResponse.json({ error: 'PO not found' }, { status: 404 });

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Only PDF, JPEG and PNG files are allowed.' }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'File exceeds 10 MB limit.' }, { status: 400 });
    }

    const ext = EXT_MAP[file.type] ?? 'bin';
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const filename = `${Date.now()}-${safeName}`;

    const dir = getUploadDir(session.businessId, po.po_number);
    fs.mkdirSync(dir, { recursive: true });

    const arrayBuffer = await file.arrayBuffer();
    fs.writeFileSync(path.join(dir, filename), Buffer.from(arrayBuffer));

    await ImsPoFilesRepo.add(
      poId,
      session.businessId,
      filename,
      file.name,
      file.type,
      file.size,
    );

    const files = await ImsPoFilesRepo.list(poId, session.businessId);
    return NextResponse.json({ success: true, files });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * GET /api/ims/purchase-orders/[id]/files
 * Returns the list of files for a PO.
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const poId = Number(params.id);
  if (isNaN(poId)) return NextResponse.json({ error: 'Invalid PO id' }, { status: 400 });
  const po = await ImsPORepo.get(poId, session.businessId).catch(() => null);
  if (!po) return NextResponse.json({ error: 'PO not found' }, { status: 404 });
  const files = await ImsPoFilesRepo.list(poId, session.businessId).catch(() => []);
  return NextResponse.json({ success: true, files });
}
