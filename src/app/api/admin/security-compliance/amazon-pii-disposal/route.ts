import { NextResponse } from 'next/server';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { AmazonPiiConflictError, AmazonPiiNotFoundError, AmazonPiiValidationError, validateAmazonPiiDisposalRequest } from '@/lib/securityCompliance/amazonPiiDisposal';
import { approveAmazonPiiDisposal, getAmazonPiiDisposalPreview } from '@/lib/securityCompliance/amazonPiiDisposalRepository';

const headers = { 'Cache-Control': 'no-store' };
async function failure(error: unknown, businessId: string, actorUserId: number, operation: string) {
  if (error instanceof AmazonPiiValidationError) return NextResponse.json({ error: error.message }, { status: 400, headers });
  if (error instanceof AmazonPiiConflictError) return NextResponse.json({ error: error.message }, { status: 409, headers });
  if (error instanceof AmazonPiiNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers });
  await reportRuntimeIssue({
    businessId, source: 'admin.amazon-pii-disposal', operation, title: 'Amazon identifying-field cleanup could not complete',
    error, context: { actorUserId },
  });
  return NextResponse.json({ error: 'Cleanup could not complete. Check Runtime Issues and whether the approved tenant rollout is ready.' }, { status: 500, headers });
}

export async function GET(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const raw = params.get('salesOrderId') ?? '';
  if ([...params.keys()].some(key => key !== 'salesOrderId') || params.getAll('salesOrderId').length !== 1
    || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 2_147_483_647) {
    return NextResponse.json({ error: 'Provide one local Amazon sales order ID. Scope comes from the active business.' }, { status: 400, headers });
  }
  try {
    const report = await getAmazonPiiDisposalPreview({
      businessId: auth.user.businessId, actorUserId: auth.user.userId, salesOrderId: Number(raw),
    });
    return NextResponse.json({ success: true, report }, { headers });
  } catch (error) { return failure(error, auth.user.businessId, auth.user.userId, 'preview'); }
}

export async function POST(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Provide valid JSON.' }, { status: 400, headers }); }
  try {
    const input = validateAmazonPiiDisposalRequest(body);
    const result = await approveAmazonPiiDisposal({ businessId: auth.user.businessId, actorUserId: auth.user.userId, request: input });
    return NextResponse.json({ success: true, result }, { headers });
  } catch (error) { return failure(error, auth.user.businessId, auth.user.userId, 'approve_cleanup'); }
}
