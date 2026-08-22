import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import type { WholesaleLayoutDocument } from './layout/types';
import { getPublicWholesaleProductTeasers, type WholesaleFeaturedProductTeaser } from './wholesaleFeaturedProducts';

export async function getWholesalePublicLoginProducts(
  businessId: string,
  supplierSlug: string,
  publishedLayout: WholesaleLayoutDocument,
): Promise<WholesaleFeaturedProductTeaser[]> {
  const productIds = publishedLayout.pages.login.sections
    .filter(section => section.type === 'featured_products')
    .flatMap(section => section.settings.productIds ?? []);
  try {
    return await getPublicWholesaleProductTeasers(businessId, productIds);
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'wholesale_portal',
      operation: 'load_public_featured_products',
      severity: 'warning',
      title: 'Wholesale Login featured products could not be loaded',
      error,
      context: { supplierSlug, requestedProductCount: productIds.length },
    });
    return [];
  }
}
