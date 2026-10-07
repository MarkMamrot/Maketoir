import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { buildReport } from '@/lib/ims/cogsTraceability/service';
import { parseRequest, ReportValidationError } from '@/lib/ims/cogsTraceability/request';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId);
  try {
    const timeZone = await getBusinessTimeZone(businessId);
    const parameters = parseRequest(new URL(request.url).searchParams, new Date().toLocaleDateString('sv-SE', { timeZone }));
    const report = await runImsForBusiness(businessId, () => buildReport(businessId, parameters));
    const { exportRows, ...body } = report;
    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ReportValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    await reportRuntimeIssue({ businessId, source: 'ims_cogs_traceability', operation: 'load_report', title: 'Sales and COGS Traceability could not be loaded', error }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Unable to load Sales and COGS Traceability. Please retry or contact support.' }, { status: 500 });
  }
}