import fs from 'fs';
import path from 'path';
import { ImsImagesRepo } from '@/lib/ims/ImsRepository';
import { imsQuery } from '@/services/IMSMySQLService';

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

/**
 * GET /api/ims/products/[id]/images/[imageId]/file
 * Serves a product image stored on the Railway Volume.
 * Publicly accessible — product images are publicly visible on the online store.
 */
export async function GET(
  _: Request,
  { params }: { params: { id: string; imageId: string } },
) {
  const imageId = Number(params.imageId);
  if (isNaN(imageId)) return new Response('Invalid imageId', { status: 400 });

  const record = await ImsImagesRepo.get(imageId).catch(() => null);
  if (!record || record.source !== 'volume' || !record.drive_file_id) {
    return new Response('Not found', { status: 404 });
  }
  if (record.product_id !== params.id) return new Response('Not found', { status: 404 });

  // Resolve business_id from the product (used as the upload subdirectory)
  const productRows = await imsQuery<{ business_id: string }>(
    'SELECT business_id FROM ims_products WHERE product_id = ? LIMIT 1',
    [params.id],
  ).catch(() => []);
  const businessId = productRows[0]?.business_id ?? '';
  if (!businessId) return new Response('Not found', { status: 404 });

  const filePath = path.join(
    process.env.UPLOAD_BASE_PATH ?? './uploads',
    businessId,
    'product-images',
    record.drive_file_id,
  );
  if (!fs.existsSync(filePath)) return new Response('File not found on disk', { status: 404 });

  const ext = record.drive_file_id.split('.').pop()?.toLowerCase() ?? 'jpg';
  const buffer = fs.readFileSync(filePath);

  return new Response(buffer, {
    headers: {
      'Content-Type': MIME_MAP[ext] ?? 'application/octet-stream',
      'Content-Length': String(buffer.length),
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
