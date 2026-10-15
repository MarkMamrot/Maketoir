import { NextResponse } from 'next/server';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { PolicyAssignmentValidationError, validatePolicyAssignments, type PolicyAssignments } from '@/lib/securityCompliance/policies';
import { getPolicyAssignments, PolicyAssignmentConflictError, savePolicyAssignments } from '@/lib/securityCompliance/repository';

export async function GET() {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({ success: true, state: await getPolicyAssignments() }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: auth.user.businessId, source: 'admin.security-compliance', operation: 'load_responsibilities',
      title: 'Security policy responsibilities could not be loaded', error,
      context: { actorUserId: auth.user.userId },
    });
    return NextResponse.json({ error: 'Security policy responsibilities could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Provide a valid responsibilities request.' }, { status: 400 });
  }
  const values = body as Record<string, unknown>;
  const expectedRevision = values.expectedRevision;
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    return NextResponse.json({ error: 'Provide the saved responsibility revision.' }, { status: 400 });
  }
  let assignments: PolicyAssignments;
  try {
    assignments = validatePolicyAssignments(values.assignments);
  } catch (error) {
    if (!(error instanceof PolicyAssignmentValidationError)) throw error;
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  try {
    const state = await savePolicyAssignments({ assignments, expectedRevision, actorUserId: auth.user.userId });
    return NextResponse.json({ success: true, state }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof PolicyAssignmentConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId: auth.user.businessId, source: 'admin.security-compliance', operation: 'save_responsibilities',
      title: 'Security policy responsibilities could not be saved', error,
      context: { actorUserId: auth.user.userId, expectedRevision },
    });
    return NextResponse.json({ error: 'Security policy responsibilities could not be saved.' }, { status: 500 });
  }
}
