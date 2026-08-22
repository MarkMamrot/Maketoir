import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  detectWholesaleLayoutAssetType,
  safeWholesaleLayoutAssetOriginalName,
  validateWholesaleLayoutAssetFile,
  wholesaleLayoutAssetPath,
} from '../wholesalePortalAssetStorage';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('wholesale portal asset storage', () => {
  it('detects allowlisted image signatures', () => {
    expect(detectWholesaleLayoutAssetType(png)).toEqual({ mimeType: 'image/png', extension: '.png' });
    expect(detectWholesaleLayoutAssetType(Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).toBeNull();
  });

  it('requires declared MIME, extension and bytes to agree', () => {
    expect(validateWholesaleLayoutAssetFile({ name: 'hero.png', type: 'image/png', size: png.length }, png)).toEqual({ mimeType: 'image/png', extension: '.png' });
    expect(() => validateWholesaleLayoutAssetFile({ name: 'hero.jpg', type: 'image/png', size: png.length }, png)).toThrow('extension');
    expect(() => validateWholesaleLayoutAssetFile({ name: 'hero.png', type: 'image/jpeg', size: png.length }, png)).toThrow('valid JPEG');
  });

  it('generates only contained paths from trusted owner and stored filename formats', () => {
    const stored = '123e4567-e89b-12d3-a456-426614174000.png';
    expect(wholesaleLayoutAssetPath('biz-1', stored).endsWith(path.join('biz-1', 'wholesale-layout-assets', stored))).toBe(true);
    expect(() => wholesaleLayoutAssetPath('biz-1', '../secret.png')).toThrow('filename');
    expect(() => wholesaleLayoutAssetPath('../biz', stored)).toThrow('owner');
  });

  it('strips path components and unsafe original-name characters', () => {
    expect(safeWholesaleLayoutAssetOriginalName('../../hero<script>.png', '.png')).toBe('hero_script_.png');
  });
});
