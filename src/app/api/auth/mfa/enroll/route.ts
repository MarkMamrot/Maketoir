import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { UsersRepository } from '@/lib/db/UsersRepository';
import { beginTotpEnrollment, getActivePreauthSession } from '@/lib/auth/mfaRepository';
import { createTotpSecret, createTotpUri } from '@/lib/auth/totp';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(req: Request) {
  try {
    const { preauthToken } = await req.json();
    if (typeof preauthToken !== 'string' || !preauthToken) {
      return NextResponse.json({ success: false, error: 'Enrollment session is required.' }, { status: 400 });
    }

    const preauth = await getActivePreauthSession(preauthToken, 'enroll');
    if (!preauth) {
      return NextResponse.json({ success: false, error: 'Enrollment session has expired. Please sign in again.' }, { status: 401 });
    }
    const user = await UsersRepository.findById(preauth.userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Account not found.' }, { status: 401 });
    }

    const secret = createTotpSecret();
    await beginTotpEnrollment(user.id, secret);
    const uri = createTotpUri(user.email, secret);
    const qrDataUrl = await QRCode.toDataURL(uri, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280,
    });

    return NextResponse.json({
      success: true,
      qrDataUrl,
      manualKey: secret,
      expiresAt: preauth.expiresAt.toISOString(),
    });
  } catch (error) {
    await reportRuntimeIssue({
      source: 'auth.mfa',
      operation: 'begin_enrollment',
      severity: 'error',
      title: 'MFA enrollment setup failed',
      error,
    });
    return NextResponse.json({ success: false, error: 'Unable to start authenticator setup.' }, { status: 500 });
  }
}