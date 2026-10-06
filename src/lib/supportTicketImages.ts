import path from 'node:path';
import { mkdir, readdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { detectOnlineShopAssetType } from '@/lib/onlineShop/onlineShopAssetStorage';

export const SUPPORT_IMAGE_LIMIT = 5;
export const SUPPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const SUPPORT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export class SupportTicketValidationError extends Error {}

export interface SupportTicketImage {
  filename: string;
  url: string;
}

export function validateSupportImage(file: { size: number; type: string }, bytes: Uint8Array) {
  if (!file.size || file.size > SUPPORT_IMAGE_MAX_BYTES || bytes.length !== file.size) {
    throw new SupportTicketValidationError('Each image must be between 1 byte and 5 MB.');
  }
  const detected = detectOnlineShopAssetType(bytes);
  if (!detected || detected.mimeType !== file.type || !SUPPORT_IMAGE_TYPES.includes(file.type)) {
    throw new SupportTicketValidationError('Only JPEG, PNG, WebP and GIF images are allowed.');
  }
  return detected;
}

export function supportImageDirectory(id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new SupportTicketValidationError('Invalid ticket id.');
  return path.resolve(process.env.UPLOAD_BASE_PATH ?? './uploads', 'support-ticket-images', String(id));
}

export function supportImagePath(id: number, filename: string) {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(filename)) {
    throw new SupportTicketValidationError('Invalid image filename.');
  }
  return path.join(supportImageDirectory(id), filename);
}

export async function readSupportTicketSubmission(request: Request) {
  let body: Record<string, unknown>;
  let files: File[] = [];
  if (request.headers.get('content-type')?.includes('multipart/form-data')) {
    const form = await request.formData();
    body = Object.fromEntries(['subject', 'description', 'screenContext'].map(key => [key, form.get(key)]));
    const entries = form.getAll('images');
    if (entries.length > SUPPORT_IMAGE_LIMIT || entries.some(entry => typeof entry === 'string')) {
      throw new SupportTicketValidationError('Attach up to five images.');
    }
    files = entries as File[];
  } else {
    body = await request.json();
  }
  if (!body || typeof body.subject !== 'string' || typeof body.description !== 'string' || !body.subject.trim() || !body.description.trim()) {
    throw new SupportTicketValidationError('Subject and description are required.');
  }
  if (body.subject.length > 255 || body.description.length > 10_000) {
    throw new SupportTicketValidationError('Subject or description is too long.');
  }
  const images = [];
  for (const file of files) {
    if (file.size > SUPPORT_IMAGE_MAX_BYTES) throw new SupportTicketValidationError('Each image must be at most 5 MB.');
    const bytes = Buffer.from(await file.arrayBuffer());
    const detected = validateSupportImage(file, bytes);
    images.push({ bytes, extension: detected.extension });
  }
  return {
    subject: body.subject.trim(), description: body.description.trim(),
    screenContext: typeof body.screenContext === 'string' ? body.screenContext.trim().slice(0, 255) || null : null,
    images,
  };
}

export async function saveSupportImages(id: number, images: Array<{ bytes: Buffer; extension: string }>) {
  if (!images.length) return;
  await mkdir(supportImageDirectory(id), { recursive: true });
  for (const image of images) {
    await writeFile(supportImagePath(id, `${randomUUID()}${image.extension}`), image.bytes, { flag: 'wx' });
  }
}

export async function removeSupportImages(id: number) {
  await rm(supportImageDirectory(id), { recursive: true, force: true });
}

export async function listSupportImages(id: number): Promise<SupportTicketImage[]> {
  let filenames: string[];
  try { filenames = await readdir(supportImageDirectory(id)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return filenames.filter(filename => /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(filename)).sort().map(filename => ({
    filename, url: `/api/admin/support-tickets/${id}/images/${filename}`,
  }));
}