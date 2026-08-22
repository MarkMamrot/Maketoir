import fs from 'node:fs/promises';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { WholesalePortalAssetRepository } from '@/lib/wholesale/wholesalePortalAsset';
import { wholesaleLayoutAssetPath } from '@/lib/wholesale/wholesalePortalAssetStorage';

export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: { assetId: string } }) {
  if (!/^[0-9a-f-]{36}$/.test(params.assetId)) return new Response('Not found', { status: 404 });
  let asset;
  try {
    asset = await WholesalePortalAssetRepository.getPublicActive(params.assetId);
    if (!asset) return new Response('Not found', { status: 404 });
    const bytes = await fs.readFile(wholesaleLayoutAssetPath(asset.businessId, asset.storedFilename));
    return new Response(bytes, {
      headers: {
        'Content-Type': asset.mimeType,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        ETag: `"${asset.assetId}"`,
      },
    });
  } catch (error: any) {
    await reportRuntimeIssue({
      businessId: asset?.businessId,
      source: 'wholesale_layout_assets',
      operation: 'serve',
      severity: 'warning',
      title: 'Wholesale layout image could not be served',
      error,
      reference: { type: 'wholesale_layout_asset', id: params.assetId },
    });
    return new Response('Not found', { status: 404 });
  }
}
