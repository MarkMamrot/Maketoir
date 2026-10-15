import { NextResponse } from 'next/server';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { PolicyEvidenceValidationError, validatePolicyEvidenceRequest, type PolicyEvidenceRequest } from '@/lib/securityCompliance/policyEvidence';
import { getAuthenticationReviewData, getPolicyEvidence, PolicyEvidenceConflictError, savePolicyEvidence } from '@/lib/securityCompliance/repository';

export async function GET(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  try {
    const params = new URL(request.url).searchParams;
    if (params.get('authentication') === '1') {
      const beforeId = params.get('beforeId');
      const logs = await getAuthenticationReviewData({
        from: params.get('from') ?? '', through: params.get('through') ?? '',
        beforeId: beforeId === null ? undefined : Number(beforeId),
      });
      return NextResponse.json({ success: true, logs }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ success: true, state: await getPolicyEvidence() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof PolicyEvidenceValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    await reportRuntimeIssue({
      businessId: auth.user.businessId, source: 'admin.security-compliance', operation: 'read_policy_evidence',
      title: 'Security review and adoption evidence could not be loaded', error, context: { actorUserId: auth.user.userId },
    });
    return NextResponse.json({ error: 'Security review evidence could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  let input: PolicyEvidenceRequest;
  try {
    input = validatePolicyEvidenceRequest(await request.json().catch(() => null));
  } catch (error) {
    if (!(error instanceof PolicyEvidenceValidationError)) throw error;
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  try {
    const record = await savePolicyEvidence({ request: input, actorUserId: auth.user.userId });
    return NextResponse.json({ success: true, record }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof PolicyEvidenceConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    await reportRuntimeIssue({
      businessId: auth.user.businessId, source: 'admin.security-compliance', operation: 'record_policy_evidence',
      title: 'Security review or policy adoption could not be recorded', error,
      context: { actorUserId: auth.user.userId, policyId: input.policyId, kind: input.kind },
    });
    return NextResponse.json({ error: 'Security review evidence could not be saved.' }, { status: 500 });
  }
}
