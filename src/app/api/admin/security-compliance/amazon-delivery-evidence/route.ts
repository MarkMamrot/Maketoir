import { NextResponse } from 'next/server';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import {
  DeliveryEvidenceConflictError, DeliveryEvidenceValidationError, validateManualDeliveryRequest,
} from '@/lib/securityCompliance/amazonDeliveryEvidence';
import {
  DeliveryEvidenceNotFoundError, getAmazonDeliveryEvidence, saveManualDeliveryEvidence,
} from '@/lib/securityCompliance/amazonDeliveryEvidenceRepository';

const headers = { 'Cache-Control': 'no-store' };

async function failure(error: unknown, businessId: string, actorUserId: number, operation: string) {
  if (error instanceof DeliveryEvidenceValidationError || error instanceof DeliveryEvidenceConflictError || error instanceof DeliveryEvidenceNotFoundError) {
    return NextResponse.json({ error: error.message }, {
      status: error instanceof DeliveryEvidenceConflictError ? 409 : error instanceof DeliveryEvidenceNotFoundError ? 404 : 400, headers,
    });
  }
  await reportRuntimeIssue({
    businessId, source: 'admin.amazon-delivery-evidence', operation, title: 'Amazon delivery evidence workflow failed',
    error, context: { actorUserId },
  });
  return NextResponse.json({ error: 'Delivery evidence is unavailable. Check Runtime Issues and the active business schema.' }, { status: 503, headers });
}

export async function GET(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const raw = params.get('salesOrderId') ?? '';
  const id = Number(raw);
  if ([...params.keys()].some(key => key !== 'salesOrderId') || params.getAll('salesOrderId').length !== 1
    || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(id) || String(id) !== raw) {
    return NextResponse.json({ error: 'Provide one local Amazon sales order ID. Scope is the active business.' }, { status: 400, headers });
  }
  try {
    return NextResponse.json({ success: true, report: await getAmazonDeliveryEvidence(auth.user.businessId, id) }, { headers });
  } catch (error) { return failure(error, auth.user.businessId, auth.user.userId, 'read_evidence'); }
}

export async function POST(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  if (new URL(request.url).search) return NextResponse.json({ error: 'Query overrides are not supported.' }, { status: 400, headers });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Provide valid JSON.' }, { status: 400, headers }); }
  try {
    const input = validateManualDeliveryRequest(body);
    const evidenceId = await saveManualDeliveryEvidence(auth.user.businessId, auth.user.userId, input);
    return NextResponse.json({ success: true, evidenceId }, { headers });
  } catch (error) { return failure(error, auth.user.businessId, auth.user.userId, 'save_evidence'); }
}
