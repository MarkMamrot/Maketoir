import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminTier } from '@/lib/sessionUtils';
import { WholesalePortalAssetRepository } from '@/lib/wholesale/wholesalePortalAsset';
import {
  safeWholesaleLayoutAssetOriginalName,
  validateWholesaleLayoutAssetFile,
  wholesaleLayoutAssetDirectory,
  wholesaleLayoutAssetPath,
} from '@/lib/wholesale/wholesalePortalAssetStorage';

export const runtime = 'nodejs';

export async function GET() {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({ success: true, assets: await WholesalePortalAssetRepository.listOwned(auth.user.businessId) });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'wholesale_layout_assets', operation: 'list', title: 'Wholesale layout assets could not be listed', error });
    return NextResponse.json({ success: false, error: 'Layout images could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;

  let file: File;
  let bytes: Uint8Array;
  let extension: string;
  let mimeType: string;
  let altText: string | null;
  try {
    const form = await request.formData();
    const candidate = form.get('file');
    if (!(candidate instanceof File)) throw new Error('Choose an image to upload.');
    file = candidate;
    bytes = new Uint8Array(await file.arrayBuffer());
    ({ extension, mimeType } = validateWholesaleLayoutAssetFile(file, bytes));
    const rawAltText = String(form.get('altText') ?? '').trim();
    if (rawAltText.length > 500) throw new Error('Alt text must be 500 characters or fewer.');
    altText = rawAltText || null;
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Invalid image upload.' }, { status: 400 });
  }

  const assetId = randomUUID();
  const storedFilename = `${assetId}${extension}`;
  const storedPath = wholesaleLayoutAssetPath(auth.user.businessId, storedFilename);
  try {
    await fs.mkdir(wholesaleLayoutAssetDirectory(auth.user.businessId), { recursive: true });
    await fs.writeFile(storedPath, bytes, { flag: 'wx' });
    const asset = await WholesalePortalAssetRepository.create({
      assetId,
      businessId: auth.user.businessId,
      storedFilename,
      mimeType,
      byteSize: bytes.byteLength,
      originalName: safeWholesaleLayoutAssetOriginalName(file.name, extension),
      altText,
      actor: { userId: auth.user.userId, name: auth.user.name },
    });
    return NextResponse.json({ success: true, asset }, { status: 201 });
  } catch (error) {
    await fs.unlink(storedPath).catch(() => {});
    await reportRuntimeIssue({
      businessId: auth.user.businessId,
      source: 'wholesale_layout_assets',
      operation: 'upload',
      title: 'Wholesale layout image upload failed',
      error,
      context: { mimeType, byteSize: bytes.byteLength, extension: path.extname(storedFilename) },
      reference: { type: 'wholesale_layout_asset', id: assetId },
    });
    return NextResponse.json({ success: false, error: 'The layout image could not be uploaded.' }, { status: 500 });
  }
}
