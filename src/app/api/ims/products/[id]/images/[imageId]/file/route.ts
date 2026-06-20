import { cookies } from 'next/headers';
import fs from 'fs';
import path from 'path';
import { ImsImagesRepo } from '@/lib/ims/ImsRepository';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

/**
 * GET /api/ims/products/[id]/images/[imageId]/file
 * Serves a product image stored on the Railway Volume.
 */
export async function GET(
  _: Request,
  { params }: { params: { id: string; imageId: string } },
) {
  const session = getSession();
  if (!session) return new Response('Not authenticated', { status: 401 });

  const imageId = Number(params.imageId);
  if (isNaN(imageId)) return new Response('Invalid imageId', { status: 400 });

  const record = await ImsImagesRepo.get(imageId).catch(() => null);
  if (!record || record.source !== 'volume' || !record.drive_file_id) {
    return new Response('Not found', { status: 404 });
  }
  // Ensure the record belongs to the requested product
  if (record.product_id !== params.id) {
    return new Response('Not found', { status: 404 });
  }

  const filePath = path.join(
    process.env.UPLOAD_BASE_PATH ?? './uploads',
    session.userSpreadsheetId,
    'product-images',
    record.drive_file_id,
  );

  if (!fs.existsSync(filePath)) {
    return new Response('File not found on disk', { status: 404 });
  }

  const ext = record.drive_file_id.split('.').pop()?.toLowerCase() ?? 'jpg';
  const contentType = MIME_MAP[ext] ?? 'application/octet-stream';
  const buffer = fs.readFileSync(filePath);

  return new Response(buffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
