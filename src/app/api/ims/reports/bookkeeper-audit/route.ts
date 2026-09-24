import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { getImsDbNameStrict } from '@/lib/db/BusinessRegistry';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { loadCogsAuditFindings, loadOperationalAuditFindings } from '@/lib/ims/bookkeeperAudit/detectors';
import { compareAuditFindingsNewestFirst, previousCalendarMonth } from '@/lib/ims/bookkeeperAudit/domain';
import { applyAuditReviews } from '@/lib/ims/bookkeeperAudit/presentation';
import { listAcceptedAuditReviews } from '@/lib/ims/bookkeeperAudit/repository';
import { loadXeroAuditFindings } from '@/lib/ims/bookkeeperAudit/xeroAdapter';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId);
  const requestedStatus = new URL(request.url).searchParams.get('status') ?? 'open';
  if (!['open', 'accepted', 'all'].includes(requestedStatus)) {
    return NextResponse.json({ success: false, error: 'Invalid audit status.' }, { status: 400 });
  }

  try {
    const imsDbName = await getImsDbNameStrict(businessId);
    if (!imsDbName) return NextResponse.json({ success: false, error: 'IMS tenant database is not configured.' }, { status: 409 });
    const timeZone = await getBusinessTimeZone(businessId);
    const asOfDate = new Date().toLocaleDateString('sv-SE', { timeZone });
    const cogsPeriod = previousCalendarMonth(asOfDate);
    const [findings, reviews, cogsResult, xeroResult] = await Promise.all([
      loadOperationalAuditFindings(businessId, asOfDate),
      listAcceptedAuditReviews(businessId),
      loadCogsAuditFindings(businessId, cogsPeriod).then(value => ({ status: 'fulfilled' as const, value })).catch(error => ({ status: 'rejected' as const, error })),
      loadXeroAuditFindings(businessId, imsDbName).then(value => ({ status: 'fulfilled' as const, value })).catch(error => ({ status: 'rejected' as const, error })),
    ]);
    if (cogsResult.status === 'rejected') {
      await reportRuntimeIssue({
        businessId, source: 'ims_bookkeeper_audit', operation: 'load_cogs_findings',
        title: 'Bookkeeper Audit COGS checks could not be loaded', error: cogsResult.error,
        context: cogsPeriod,
      }).catch(() => {});
    }
    if (xeroResult.status === 'rejected') {
      await reportRuntimeIssue({
        businessId, source: 'ims_bookkeeper_audit', operation: 'load_xero_findings',
        title: 'Bookkeeper Audit Xero checks could not be loaded', error: xeroResult.error,
      }).catch(() => {});
    }
    const xeroFindings = xeroResult.status === 'fulfilled' ? xeroResult.value.findings : [];
    const xeroReviews = xeroResult.status === 'fulfilled' ? xeroResult.value.reviews : [];
    const reviewed = applyAuditReviews([
      ...findings,
      ...(cogsResult.status === 'fulfilled' ? cogsResult.value : []),
      ...xeroFindings,
    ].sort(compareAuditFindingsNewestFirst), [...reviews, ...xeroReviews]);
    const items = requestedStatus === 'all' ? reviewed : reviewed.filter(item => item.reviewStatus === requestedStatus);
    return NextResponse.json({
      success: true,
      asOfDate,
      checkedAt: new Date().toISOString(),
      period: { cogs: cogsPeriod },
      coverage: {
        operational: 'checked',
        cogs: cogsResult.status === 'fulfilled' ? 'checked' : 'unable_to_check',
        xero: xeroResult.status === 'fulfilled' ? 'checked' : 'unable_to_check',
        monthEndInventory: 'not_yet_checked',
      },
      summary: {
        open: reviewed.filter(item => item.reviewStatus === 'open').length,
        accepted: reviewed.filter(item => item.reviewStatus === 'accepted').length,
        critical: reviewed.filter(item => item.reviewStatus === 'open' && item.severity === 'critical').length,
        error: reviewed.filter(item => item.reviewStatus === 'open' && item.severity === 'error').length,
        warning: reviewed.filter(item => item.reviewStatus === 'open' && item.severity === 'warning').length,
      },
      items,
    });
  } catch (error: any) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims_bookkeeper_audit',
      operation: 'load_report',
      title: 'Bookkeeper Audit report could not be loaded',
      error,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message || 'Failed to load Bookkeeper Audit.' }, { status: 500 });
  }
}