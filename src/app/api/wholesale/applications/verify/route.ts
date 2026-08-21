import { NextResponse } from 'next/server';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { verifyWholesaleApplication } from '@/lib/wholesale/wholesaleApplication';
import { WholesaleSupplierProfileRepository } from '@/lib/wholesale/wholesaleSupplierProfile';

export async function POST(request: Request) {
  let businessId: string | null = null;
  try {
    const body = await request.json();
    const token = typeof body.token === 'string' ? body.token : '';
    if (!token || token.length > 128) {
      return NextResponse.json({ error: 'This verification link is invalid.' }, { status: 400 });
    }
    const profile = await WholesaleSupplierProfileRepository.getActiveBySlug(body.slug);
    if (!profile) return NextResponse.json({ error: 'Wholesale supplier not found.' }, { status: 404 });
    businessId = profile.businessId;

    const result = await verifyWholesaleApplication({ businessId: profile.businessId, token });
    if (result === 'verified' || result === 'already_processed') {
      return NextResponse.json({
        success: true,
        message: `Your email is verified. ${profile.displayName} will review your application.`,
      });
    }
    return NextResponse.json({
      error: result === 'expired'
        ? 'This verification link has expired. Submit the application again for a new link.'
        : 'This verification link is invalid.',
    }, { status: 400 });
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'wholesale.application',
      operation: 'verify_email',
      title: 'Wholesale application email verification failed',
      error,
    });
    return NextResponse.json({ error: 'Email verification failed. Please try again.' }, { status: 500 });
  }
}