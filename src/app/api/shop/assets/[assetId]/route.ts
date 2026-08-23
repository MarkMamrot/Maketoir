import fs from 'node:fs/promises';
import { OnlineShopAssetRepository } from '@/lib/onlineShop/onlineShopAsset';
import { onlineShopAssetPath } from '@/lib/onlineShop/onlineShopAssetStorage';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: { assetId: string } }) {
  if (!/^[0-9a-f-]{36}$/.test(params.assetId)) return new Response('Not found', { status: 404 });
  let asset;
  try {
    asset = await OnlineShopAssetRepository.getPublicActive(params.assetId);
    if (!asset) return new Response('Not found', { status: 404 });
    const bytes = await fs.readFile(onlineShopAssetPath(asset.businessId, asset.storedFilename));
    return new Response(bytes, { headers: { 'Content-Type': asset.mimeType, 'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', ETag: `"${asset.assetId}"` } });
  } catch (error) {
    await reportRuntimeIssue({ businessId: asset?.businessId, source: 'online_shop_assets', operation: 'serve', severity: 'warning',
      title: 'Online shop image could not be served', error, reference: { type: 'online_shop_asset', id: params.assetId } }).catch(() => {});
    return new Response('Not found', { status: 404 });
  }
}