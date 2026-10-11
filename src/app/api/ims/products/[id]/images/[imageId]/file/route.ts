import fs from 'fs';
import path from 'path';
import { ImsImagesRepo } from '@/lib/ims/ImsRepository';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};

/**
 * GET /api/ims/products/[id]/images/[imageId]/file
 * Serves a product image stored on the Railway Volume.
 * Publicly accessible — product images are publicly visible on the online store.
 */
export async function GET(
  req: Request,
  { params }: { params: { id: string; imageId: string } },
) {
  const imageId = Number(params.imageId);
  if (!Number.isSafeInteger(imageId) || imageId <= 0) return new Response('Invalid imageId', { status: 400 });
  const session = await getImsSession(['marketoir_session', 'pos_session']);
  const tenantBusinessId = session?.businessId || new URL(req.url).searchParams.get('businessId');
  if (!tenantBusinessId) return new Response('Not found', { status: 404 });
  try {
    return await runImsForBusiness(tenantBusinessId, async () => {

  const record = await ImsImagesRepo.get(imageId);
  if (!record || record.source !== 'volume' || !record.drive_file_id) {
    return new Response('Not found', { status: 404 });
  }
  if (record.product_id !== params.id) return new Response('Not found', { status: 404 });

  // Resolve business_id from the product (used as the upload subdirectory)
  const productRows = await imsQuery<{ business_id: string }>(
    'SELECT business_id FROM ims_products WHERE product_id = ? LIMIT 1',
    [params.id],
  );
  const businessId = productRows[0]?.business_id ?? '';
  if (!businessId || businessId !== tenantBusinessId) return new Response('Not found', { status: 404 });
  if (path.basename(record.drive_file_id) !== record.drive_file_id) return new Response('Not found', { status: 404 });

  const filePath = path.join(
    process.env.UPLOAD_BASE_PATH ?? './uploads',
    businessId,
    'product-images',
    record.drive_file_id,
  );
  if (!fs.existsSync(filePath)) {
    await reportRuntimeIssue({ businessId, source: 'product-images', operation: 'missing_file', title: 'Stored product image file is missing', reference: { type: 'product', id: params.id }, context: { imageId } });
    return new Response('File not found on disk', { status: 404 });
  }

  const ext = record.drive_file_id.split('.').pop()?.toLowerCase() ?? 'jpg';
  const buffer = fs.readFileSync(filePath);
  const contentType = MIME_MAP[ext] ?? 'application/octet-stream';

  const range = req.headers.get('range');
  if (range && contentType.startsWith('video/')) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : buffer.length - 1;
      if (start >= 0 && end >= start && start < buffer.length) {
        const chunk = buffer.subarray(start, Math.min(end, buffer.length - 1) + 1);
        return new Response(chunk, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(chunk.length),
            'Content-Range': `bytes ${start}-${start + chunk.length - 1}/${buffer.length}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': session ? 'private, max-age=86400' : 'public, max-age=86400',
          },
        });
      }
    }
  }

  return new Response(buffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      'Accept-Ranges': contentType.startsWith('video/') ? 'bytes' : 'none',
      'Cache-Control': session ? 'private, max-age=86400' : 'public, max-age=86400',
    },
  });
    });
  } catch (error) {
    await reportRuntimeIssue({ businessId: tenantBusinessId, source: 'product-images', operation: 'serve_file', title: 'Product image could not be served', error, reference: { type: 'product', id: params.id } });
    return new Response('Image could not be loaded', { status: 500 });
  }
}
