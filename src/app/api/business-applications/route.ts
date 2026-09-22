import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/sessionUtils';
import { getPendingApplicantSession } from '@/lib/auth/pendingApplicantCookies';
import { BusinessApplicationsRepository } from '@/lib/db/BusinessApplicationsRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

const BUSINESS_TYPES = new Set(['retail', 'wholesale', 'hospitality', 'services', 'manufacturing', 'other']);
const LOCATION_BANDS = new Set(['1', '2-5', '6-20', '21+']);
const REVENUE_BANDS = new Set(['under_250k', '250k_1m', '1m_5m', '5m_plus', 'prefer_not_to_say']);

function identifyApplicant(): { userId: number; name: string; email: string; businessId: string | null } | null {
  const adminSession = getAdminSession();
  if (adminSession) {
    return { userId: adminSession.userId, name: adminSession.name, email: adminSession.email, businessId: adminSession.businessId };
  }
  const pending = getPendingApplicantSession();
  if (pending) {
    return { userId: pending.userId, name: pending.name, email: pending.email, businessId: null };
  }
  return null;
}

export async function GET() {
  const applicant = identifyApplicant();
  if (!applicant) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const application = await BusinessApplicationsRepository.findLatestForUser(applicant.userId);
  return NextResponse.json({ success: true, application });
}

export async function POST(req: Request) {
  const applicant = identifyApplicant();
  if (!applicant) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const businessName: string = String(body?.businessName ?? '').trim();
  const website: string = String(body?.website ?? '').trim();
  const businessType: string = String(body?.businessType ?? '').trim();
  const locationCountBand: string = String(body?.locationCountBand ?? '').trim();
  const channels: string[] = Array.isArray(body?.channels) ? body.channels.filter((c: unknown) => typeof c === 'string') : [];
  const revenueBand: string = String(body?.revenueBand ?? '').trim();
  const country: string = String(body?.country ?? '').trim();
  const abn: string = String(body?.abn ?? '').trim();
  const notes: string = String(body?.notes ?? '').trim();
  const contactPhone: string = String(body?.contactPhone ?? '').trim();

  if (!businessName) {
    return NextResponse.json({ success: false, error: 'Business name is required.' }, { status: 400 });
  }
  if (!BUSINESS_TYPES.has(businessType)) {
    return NextResponse.json({ success: false, error: 'Please select a valid business type.' }, { status: 400 });
  }
  if (website && !/^https?:\/\/.+/i.test(website)) {
    return NextResponse.json({ success: false, error: 'Please enter a valid website URL (starting with http:// or https://).' }, { status: 400 });
  }
  if (!LOCATION_BANDS.has(locationCountBand)) {
    return NextResponse.json({ success: false, error: 'Please select the number of locations.' }, { status: 400 });
  }
  if (revenueBand && !REVENUE_BANDS.has(revenueBand)) {
    return NextResponse.json({ success: false, error: 'Please select a valid revenue range.' }, { status: 400 });
  }

  // Prevent re-submitting while an application is already pending review.
  const latest = await BusinessApplicationsRepository.findLatestForUser(applicant.userId);
  if (latest && latest.status === 'pending_review') {
    return NextResponse.json({ success: false, error: 'An application is already awaiting review.' }, { status: 409 });
  }

  try {
    const flowType = applicant.businessId ? 'existing_user' : 'new_user';
    const id = await BusinessApplicationsRepository.create({
      flowType,
      applicantUserId: applicant.userId,
      contactName: flowType === 'new_user' ? applicant.name : null,
      contactEmail: flowType === 'new_user' ? applicant.email : null,
      contactPhone: flowType === 'new_user' ? contactPhone || null : null,
      businessName,
      website: website || null,
      businessType,
      locationCountBand,
      channels: channels.length ? channels.join(',') : null,
      revenueBand: revenueBand || null,
      country: country || null,
      abn: abn || null,
      notes: notes || null,
    });
    return NextResponse.json({ success: true, applicationId: id, flowType });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: applicant.businessId ?? undefined,
      source: 'business_applications',
      operation: 'submit_application_failed',
      severity: 'error',
      title: 'New business application could not be submitted',
      error,
      context: { applicantUserId: applicant.userId },
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Application could not be submitted. Please try again.' }, { status: 500 });
  }
}
