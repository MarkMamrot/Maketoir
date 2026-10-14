import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { loadEvidence } from '@/lib/ims/cogsTraceability/repository';
import { projectReport } from '@/lib/ims/cogsTraceability/projection';
import { parseRequest, ReportValidationError } from '@/lib/ims/cogsTraceability/request';
import { buildProductProfitability, type ProfitabilityProduct } from '@/lib/ims/productProfitability';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId);
  try {
    const search = new URL(req.url).searchParams;
    const parameters = new URLSearchParams({
      basis: 'sale', window: search.get('window') ?? '365',
      page: search.get('page') ?? '1', pageSize: search.get('pageSize') ?? '100',
    });
    for (const key of ['from', 'to']) if (search.has(key)) parameters.set(key, search.get(key)!);
    const timeZone = await getBusinessTimeZone(businessId);
    const request = parseRequest(parameters, new Date().toLocaleDateString('sv-SE', { timeZone }));
    const filters = {
      productId: search.get('productId') ?? '', brand: search.get('brand') ?? '',
      supplierId: search.get('supplierId') ?? '', productType: search.get('productType') ?? '',
      category: search.get('category') ?? '', subcategory: search.get('subcategory') ?? '',
    };
    if (filters.supplierId && !/^[1-9]\d*$/.test(filters.supplierId)) {
      throw new ReportValidationError('Invalid supplier.');
    }
    const result = await runImsForBusiness(businessId, async () => {
      const evidence = await loadEvidence(businessId, request);
      const detail = projectReport({ ...evidence, basis: 'sale', from: request.from, toExclusive: request.toExclusive });
      const products = await imsQuery<ProfitabilityProduct>(`
        SELECT v.variant_id AS variantId, v.sku, p.name, p.brand, p.supplier_contact_id AS supplierId,
               p.product_type AS productType, p.category, p.subcategory
          FROM ims_product_variants v JOIN ims_products p ON p.product_id = v.product_id
         WHERE p.business_id = ?`, [businessId]);
      return buildProductProfitability(detail, products, filters);
    });
    return NextResponse.json({
      success: true, data: result.rows.slice((request.page - 1) * request.pageSize, request.page * request.pageSize),
      total: result.rows.length, page: request.page, pageSize: request.pageSize,
      from: request.from, to: request.to, summary: result.summary,
      excludedNonProductRecords: result.excludedNonProductRecords,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ReportValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    await reportRuntimeIssue({
      businessId, source: 'ims-product-profitability', operation: 'load_report',
      title: 'Product Profitability could not be loaded', error,
      context: { dateBasis: 'sale' },
      reference: { type: 'business', id: businessId },
    });
    return NextResponse.json({
      success: false, error: 'Unable to load Product Profitability. Please retry or contact support.',
    }, { status: 500 });
  }
}
