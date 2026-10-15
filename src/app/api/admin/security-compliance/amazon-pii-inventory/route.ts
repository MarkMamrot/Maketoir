import { NextResponse } from 'next/server';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getAmazonPiiInventory } from '@/lib/securityCompliance/amazonPiiInventoryRepository';

export async function GET(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => key !== 'after')) {
    return NextResponse.json({ error: 'Only the after cursor is supported. Use the active business selector to change scope.' }, { status: 400 });
  }
  const rawAfter = params.get('after') ?? '0';
  const afterId = Number(rawAfter);
  if (!/^(0|[1-9]\d*)$/.test(rawAfter) || !Number.isSafeInteger(afterId) || afterId > 2_147_483_647 || params.getAll('after').length > 1) {
    return NextResponse.json({ error: 'Provide a valid order cursor.' }, { status: 400 });
  }
  try {
    const report = await getAmazonPiiInventory({ businessId: auth.user.businessId, afterId });
    const unavailableSources: string[] = report.sources.filter(source => source.availability === 'unavailable').map(source => source.id);
    if (report.deliveryEvidence.availability === 'unavailable') unavailableSources.push('delivery-evidence');
    if (unavailableSources.length) {
      await reportRuntimeIssue({
        businessId: auth.user.businessId, source: 'admin.amazon-pii-inventory', operation: 'check_coverage',
        title: 'Amazon PII inventory has unavailable data sources', severity: 'warning',
        context: { unavailableSources, actorUserId: auth.user.userId },
      });
    }
    return NextResponse.json({ success: true, report }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: auth.user.businessId, source: 'admin.amazon-pii-inventory', operation: 'read_inventory',
      title: 'Amazon PII inventory could not be read', error,
      context: { actorUserId: auth.user.userId, afterId },
    });
    return NextResponse.json({ error: 'Amazon PII inventory could not be read. Check Runtime Issues and the active business configuration.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
