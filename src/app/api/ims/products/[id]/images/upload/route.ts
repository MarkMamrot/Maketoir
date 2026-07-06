import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import fs from 'fs';
import path from 'path';
import { ImsImagesRepo } from '@/lib/ims/ImsRepository';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB (videos can be large)
const ALLOWED_TYPES  = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm',
]);
const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
};

function getImagesDir(businessId: string): string {
  return path.join(process.env.UPLOAD_BASE_PATH ?? './uploads', businessId, 'product-images');
}

/**
 * POST /api/ims/products/[id]/images/upload
 * Body: multipart/form-data  { file: File, alt_text?: string, is_primary?: '1'|'0' }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ success: false, error: 'No file provided.' }, { status: 400 });

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ success: false, error: 'Only JPEG, PNG, WebP, GIF, MP4, MOV and WebM are allowed.' }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ success: false, error: 'File exceeds 100 MB limit.' }, { status: 400 });
    }

    const altText   = (formData.get('alt_text') as string | null) ?? undefined;
    const isPrimary = formData.get('is_primary') === '1';

    // Write to Volume: {businessId}/product-images/{productId}-{timestamp}.{ext}
    const ext      = EXT_MAP[file.type] ?? 'jpg';
    const safeId   = params.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeId}-${Date.now()}.${ext}`;
    const dir      = getImagesDir(session.userSpreadsheetId);
    fs.mkdirSync(dir, { recursive: true });
    const buffer   = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(path.join(dir, filename), buffer);

    // Placeholder URL — updated after we have the imageId
    const imageId = await ImsImagesRepo.add(params.id, '', 'volume', {
      driveFileId: filename,
      altText,
      isPrimary,
    });

    // URL points to the serve route
    const url = `/api/ims/products/${params.id}/images/${imageId}/file`;
    await ImsImagesRepo.updateUrl(imageId, url);

    return NextResponse.json({ success: true, id: imageId, url });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
