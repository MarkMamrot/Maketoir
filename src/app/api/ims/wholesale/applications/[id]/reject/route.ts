import { NextResponse } from 'next/server';
import { requireAdminTier } from '@/lib/sessionUtils';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import {
  listWholesaleApplications,
  rejectWholesaleApplication,
} from '@/lib/wholesale/wholesaleApplicationReview';
import { sendWholesaleApplicationDecision } from '@/lib/wholesale/wholesaleApplicationNotifications';
import { WholesaleSupplierProfileRepository } from '@/lib/wholesale/wholesaleSupplierProfile';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  const applicationId = Number(params.id);
  if (!Number.isSafeInteger(applicationId) || applicationId < 1) {
    return NextResponse.json({ error: 'Invalid application ID.' }, { status: 400 });
  }
  try {
    const body = await request.json();
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const applications = await listWholesaleApplications(auth.user.businessId);
    const application = applications.find(item => item.id === applicationId);
    if (!application) return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
    await rejectWholesaleApplication({
      businessId: auth.user.businessId, applicationId,
      actorUserId: auth.user.userId, actorName: auth.user.name, reason,
    });
    const profile = await WholesaleSupplierProfileRepository.getByBusinessId(auth.user.businessId);
    if (profile) {
      await sendWholesaleApplicationDecision({
        applicationId, email: application.email, contactName: application.contactName,
        supplierName: profile.displayName, supplierSlug: profile.slug,
        decision: 'rejected', reason,
      }).catch(error => reportRuntimeIssue({
        businessId: auth.user.businessId,
        source: 'ims.wholesale_applications', operation: 'send_rejection_email',
        title: 'Wholesale rejection email could not be sent', error,
        reference: { type: 'wholesale_application', id: applicationId },
      }));
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: auth.user.businessId,
      source: 'ims.wholesale_applications', operation: 'reject',
      title: 'Wholesale application rejection failed', error,
      reference: { type: 'wholesale_application', id: applicationId },
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Rejection failed.' }, { status: 409 });
  }
}