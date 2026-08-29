import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { OnlineShopAssetRepository } from '@/lib/onlineShop/onlineShopAsset';
import { nativeShopDisabledResponse } from '@/lib/onlineShop/onlineShopCapability';
import { onlineShopAssetDirectory, onlineShopAssetPath, safeOnlineShopAssetOriginalName, validateOnlineShopAssetFile } from '@/lib/onlineShop/onlineShopAssetStorage';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminTier } from '@/lib/sessionUtils';

export const runtime = 'nodejs';

export async function GET() {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  const disabled = await nativeShopDisabledResponse(auth.user.businessId); if (disabled) return disabled;
  try { return NextResponse.json({ success: true, assets: await OnlineShopAssetRepository.listOwned(auth.user.businessId) }); }
  catch (error) {
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'online_shop_assets', operation: 'list', title: 'Online shop assets could not be listed', error }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Shop images could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  const disabled = await nativeShopDisabledResponse(auth.user.businessId); if (disabled) return disabled;
  let file: File; let bytes: Uint8Array; let extension: string; let mimeType: string; let altText: string | null;
  try {
    const form = await request.formData();
    const candidate = form.get('file');
    if (!(candidate instanceof File)) throw new Error('Choose an image to upload.');
    file = candidate; bytes = new Uint8Array(await file.arrayBuffer());
    ({ extension, mimeType } = validateOnlineShopAssetFile(file, bytes));
    const rawAltText = String(form.get('altText') ?? '').trim();
    if (rawAltText.length > 500) throw new Error('Alt text must be 500 characters or fewer.');
    altText = rawAltText || null;
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Invalid image upload.' }, { status: 400 }); }
  const assetId = randomUUID(); const storedFilename = `${assetId}${extension}`;
  const storedPath = onlineShopAssetPath(auth.user.businessId, storedFilename);
  try {
    await fs.mkdir(onlineShopAssetDirectory(auth.user.businessId), { recursive: true });
    await fs.writeFile(storedPath, bytes, { flag: 'wx' });
    const asset = await OnlineShopAssetRepository.create({ assetId, businessId: auth.user.businessId, storedFilename, mimeType,
      byteSize: bytes.byteLength, originalName: safeOnlineShopAssetOriginalName(file.name, extension), altText,
      actor: { userId: auth.user.userId, name: auth.user.name } });
    return NextResponse.json({ success: true, asset }, { status: 201 });
  } catch (error) {
    await fs.unlink(storedPath).catch(() => {});
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'online_shop_assets', operation: 'upload', title: 'Online shop image upload failed', error,
      context: { mimeType, byteSize: bytes.byteLength, extension: path.extname(storedFilename) }, reference: { type: 'online_shop_asset', id: assetId } }).catch(() => {});
    return NextResponse.json({ success: false, error: 'The shop image could not be uploaded.' }, { status: 500 });
  }
}