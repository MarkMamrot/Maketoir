import { describe, expect, it } from 'vitest';
import { detectOnlineShopAssetType, onlineShopAssetPath, safeOnlineShopAssetOriginalName, validateOnlineShopAssetFile } from '../onlineShopAssetStorage';

describe('online shop asset storage', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it('detects and validates image content independently of the filename', () => {
    expect(detectOnlineShopAssetType(png)).toEqual({ mimeType: 'image/png', extension: '.png' });
    expect(validateOnlineShopAssetFile({ name: 'hero.png', type: 'image/png', size: png.length }, png)).toEqual({ mimeType: 'image/png', extension: '.png' });
    expect(() => validateOnlineShopAssetFile({ name: 'hero.jpg', type: 'image/jpeg', size: png.length }, png)).toThrow();
  });

  it('sanitizes original names and rejects unsafe stored paths', () => {
    expect(safeOnlineShopAssetOriginalName('../bad<script>.png', '.png')).toBe('bad_script_.png');
    expect(() => onlineShopAssetPath('business-1', '../image.png')).toThrow('Invalid online shop asset filename');
  });
});