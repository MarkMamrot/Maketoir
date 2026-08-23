import sanitizeHtml from 'sanitize-html';

import type { StorefrontLayoutSectionSettings } from './layout';

const widths = new Set(['narrow', 'content', 'full']);
const alignments = new Set(['left', 'center', 'right']);
const spacings = new Set(['none', 'small', 'medium', 'large']);
const imageFits = new Set(['cover', 'contain']);
const imageRatios = new Set(['landscape', 'square', 'portrait']);

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, maxLength);
}

function validUrl(value: unknown): string | undefined {
  const url = boundedString(value, 2048);
  if (!url) return undefined;
  if (url.startsWith('/')) return url;
  try { return new URL(url).protocol === 'https:' ? url : undefined; } catch { return undefined; }
}

function validColor(value: unknown): string | undefined {
  const color = boundedString(value, 32);
  return color && /^(#[0-9a-f]{3,8}|rgb\([\d\s,.%]+\)|rgba\([\d\s,.%]+\))$/i.test(color) ? color : undefined;
}

export function sanitizeStorefrontHtml(value: unknown): string | undefined {
  const html = boundedString(value, 20_000);
  if (!html) return undefined;
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'h4', 'a'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => ({ tagName: 'a', attribs: { ...attributes, target: '_blank', rel: 'noopener noreferrer' } }),
    },
  });
}

export function normalizeStorefrontSectionSettings(
  raw: unknown,
  defaults: StorefrontLayoutSectionSettings,
): StorefrontLayoutSectionSettings {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const settings: StorefrontLayoutSectionSettings = { ...defaults };
  if (widths.has(String(value.width))) settings.width = value.width as StorefrontLayoutSectionSettings['width'];
  if (alignments.has(String(value.alignment))) settings.alignment = value.alignment as StorefrontLayoutSectionSettings['alignment'];
  if (spacings.has(String(value.spacingTop))) settings.spacingTop = value.spacingTop as StorefrontLayoutSectionSettings['spacingTop'];
  if (spacings.has(String(value.spacingBottom))) settings.spacingBottom = value.spacingBottom as StorefrontLayoutSectionSettings['spacingBottom'];
  if (imageFits.has(String(value.imageFit))) settings.imageFit = value.imageFit as StorefrontLayoutSectionSettings['imageFit'];
  if (imageRatios.has(String(value.imageRatio))) settings.imageRatio = value.imageRatio as StorefrontLayoutSectionSettings['imageRatio'];
  if (value.imageSide === 'left' || value.imageSide === 'right') settings.imageSide = value.imageSide;
  settings.backgroundColor = validColor(value.backgroundColor);
  settings.textColor = validColor(value.textColor);
  settings.heading = boundedString(value.heading, 255);
  settings.bodyHtml = sanitizeStorefrontHtml(value.bodyHtml);
  settings.imageUrl = validUrl(value.imageUrl);
  const assetId = boundedString(value.assetId, 36);
  settings.assetId = assetId && /^[0-9a-f-]{36}$/.test(assetId) ? assetId : undefined;
  settings.altText = boundedString(value.altText, 500);
  settings.linkUrl = validUrl(value.linkUrl);
  settings.linkLabel = boundedString(value.linkLabel, 100);
  settings.productIds = Array.isArray(value.productIds)
    ? [...new Set(value.productIds.map(item => boundedString(item, 100)).filter((item): item is string => Boolean(item)))].slice(0, 24)
    : defaults.productIds;
  if (Number.isSafeInteger(value.productLimit)) settings.productLimit = Math.min(12, Math.max(1, Number(value.productLimit)));
  return Object.fromEntries(Object.entries(settings).filter(([, item]) => item !== undefined));
}