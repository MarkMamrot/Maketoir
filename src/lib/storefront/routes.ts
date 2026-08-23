import type { StorefrontContext } from './channel';

function segment(value: string): string {
  return encodeURIComponent(value.trim());
}

export function storefrontPath(context: StorefrontContext, path = ''): string {
  const base = context.basePath.replace(/\/$/, '');
  const suffix = path ? `/${path.replace(/^\//, '')}` : '';
  return `${base}${suffix}` || '/';
}

export function storefrontProductPath(context: StorefrontContext, productSlug: string): string {
  return storefrontPath(context, `products/${segment(productSlug)}`);
}

export function storefrontCollectionPath(context: StorefrontContext, collectionSlug: string): string {
  return storefrontPath(context, `collections/${segment(collectionSlug)}`);
}

export function storefrontContentPagePath(context: StorefrontContext, pageSlug: string): string {
  return storefrontPath(context, `pages/${segment(pageSlug)}`);
}

export function storefrontCanonicalUrl(context: StorefrontContext, path = ''): string | null {
  if (!context.canonicalOrigin) return null;
  return new URL(storefrontPath(context, path), `${context.canonicalOrigin.replace(/\/$/, '')}/`).toString();
}