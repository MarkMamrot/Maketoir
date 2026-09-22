import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { BusinessApplicationsRepository } from '@/lib/db/BusinessApplicationsRepository';
import { provisionApprovedBusiness } from '@/lib/admin/provisionApprovedBusiness';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

function getSuperAdminSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return s?.tier === 'SuperAdmin' ? s : null;
  } catch { return null; }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = getSuperAdminSession();
  if (!session) return NextResponse.json({ error: 'SuperAdmin access required.' }, { status: 403 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid application id.' }, { status: 400 });

  const application = await BusinessApplicationsRepository.findById(id);
  if (!application) return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
  if (application.status !== 'pending_review') {
    return NextResponse.json({ error: `Application is already ${application.status}.` }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const hasForesight = body?.hasForesight !== false;
  const hasIms = body?.hasIms !== false;
  const hasPos = body?.hasPos !== false;
  const aiPlanKey = ['starter', 'core', 'scale', 'enterprise'].includes(body?.aiPlanKey) ? body.aiPlanKey : 'starter';
  const maxLocations = body?.maxLocations === '' || body?.maxLocations == null ? null : Number(body.maxLocations);
  const maxUsers = body?.maxUsers === '' || body?.maxUsers == null ? null : Number(body.maxUsers);
  const costPerLocation = body?.costPerLocation === '' || body?.costPerLocation == null ? null : Number(body.costPerLocation);

  try {
    const result = await provisionApprovedBusiness({
      businessName: application.business_name,
      applicantUserId: application.applicant_user_id,
      contactPhone: application.contact_phone,
      businessType: application.business_type,
      locationCountBand: application.location_count_band,
      channels: application.channels,
      country: application.country,
      abn: application.abn,
      notes: application.notes,
      hasForesight, hasIms, hasPos, aiPlanKey,
      maxLocations, maxUsers, costPerLocation,
    });

    await BusinessApplicationsRepository.approve(
      id,
      { userId: session.userId, name: session.name },
      result.businessId,
    );

    return NextResponse.json({ success: true, businessId: result.businessId, imsDbName: result.imsDbName });
  } catch (err: any) {
    console.error('[business-applications approve] error:', err?.message, err?.stack);
    await reportRuntimeIssue({
      businessId: undefined,
      source: 'admin_business_applications',
      operation: 'approve_failed',
      severity: 'critical',
      title: 'Business application approval failed',
      error: err,
      context: { applicationId: id },
    }).catch(() => {});
    return NextResponse.json({ error: err?.message ?? 'Approval failed.' }, { status: 500 });
  }
}
