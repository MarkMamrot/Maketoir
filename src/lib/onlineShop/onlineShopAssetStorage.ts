import path from 'node:path';

export const ONLINE_SHOP_ASSET_MAX_BYTES = 10 * 1024 * 1024;
const MIME_EXTENSIONS = new Map([['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'], ['image/gif', '.gif']]);

export function detectOnlineShopAssetType(bytes: Uint8Array): { mimeType: string; extension: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mimeType: 'image/jpeg', extension: '.jpg' };
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return { mimeType: 'image/png', extension: '.png' };
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return { mimeType: 'image/webp', extension: '.webp' };
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.slice(0, 6)))) return { mimeType: 'image/gif', extension: '.gif' };
  return null;
}

export function validateOnlineShopAssetFile(file: { name: string; type: string; size: number }, bytes: Uint8Array): { mimeType: string; extension: string } {
  if (file.size <= 0 || file.size > ONLINE_SHOP_ASSET_MAX_BYTES || bytes.byteLength !== file.size) throw new Error('Image must be between 1 byte and 10 MB.');
  const detected = detectOnlineShopAssetType(bytes);
  if (!detected || !MIME_EXTENSIONS.has(file.type) || detected.mimeType !== file.type) throw new Error('Only valid JPEG, PNG, WebP and GIF images are allowed.');
  const suppliedExtension = path.extname(path.basename(file.name)).toLowerCase();
  const matches = file.type === 'image/jpeg' ? ['.jpg', '.jpeg'].includes(suppliedExtension) : suppliedExtension === detected.extension;
  if (!matches) throw new Error('The image filename extension does not match its content.');
  return detected;
}

export function safeOnlineShopAssetOriginalName(name: string, extension: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 255) || `image${extension}`;
}

export function onlineShopAssetDirectory(businessId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(businessId)) throw new Error('Invalid online shop asset owner.');
  return path.resolve(process.env.UPLOAD_BASE_PATH ?? './uploads', businessId, 'online-shop-assets');
}

export function onlineShopAssetPath(businessId: string, storedFilename: string): string {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(storedFilename)) throw new Error('Invalid online shop asset filename.');
  const directory = onlineShopAssetDirectory(businessId);
  const resolved = path.resolve(directory, storedFilename);
  if (!resolved.startsWith(`${directory}${path.sep}`)) throw new Error('Invalid online shop asset path.');
  return resolved;
}