import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { buildReport, reportColumns } from '@/lib/ims/cogsTraceability/service';
import { csvCell, fields } from '@/lib/ims/cogsTraceability/domain';
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
    const columns = reportColumns(parameters);
    const encoder = new TextEncoder();
    let index = -1;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index === -1) controller.enqueue(encoder.encode('\uFEFF' + ['Date basis', 'From', 'To', ...parameters.groups.map(field => `${fields[field]} (Group)`), ...columns.map(field => fields[field])].map(csvCell).join(',') + '\r\n'));
        else if (index < report.exportRows.length) controller.enqueue(encoder.encode([parameters.basis, parameters.from, parameters.to, ...(parameters.groups.length ? JSON.parse(report.exportRows[index].id) : []), ...columns.map(field => report.exportRows[index][field])].map(csvCell).join(',') + '\r\n'));
        else { controller.close(); return; }
        index++;
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sales-cogs-${parameters.basis}-${parameters.from}-${parameters.to}.csv"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    if (error instanceof ReportValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    await reportRuntimeIssue({ businessId, source: 'ims_cogs_traceability', operation: 'export_report', title: 'Sales and COGS Traceability export failed', error }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Unable to export Sales and COGS Traceability.' }, { status: 500 });
  }
}