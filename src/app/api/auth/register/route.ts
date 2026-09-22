import { NextResponse } from 'next/server';
import { UsersRepository } from '@/lib/db/UsersRepository';
import { getPasswordValidation } from '@/lib/auth/passwordPolicy';
import { setPendingApplicantCookie } from '@/lib/auth/pendingApplicantCookies';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(req: Request) {
  try {
    const { name, email, phone, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ success: false, error: 'Email and password are required.' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, error: 'Invalid email address.' }, { status: 400 });
    }
    const passwordValidation = getPasswordValidation(password);
    if (!passwordValidation.isValid) {
      return NextResponse.json({ success: false, error: passwordValidation.message }, { status: 400 });
    }

    // Check for duplicate email
    const existing = await UsersRepository.findByEmail(email);
    if (existing) {
      return NextResponse.json({ success: false, error: 'An account with this email already exists.' }, { status: 409 });
    }

    // Create the user account only. No business/IMS schema is provisioned here —
    // the user is redirected to submit a short business application, which a
    // SuperAdmin reviews and approves before any business is created.
    let userId: number;
    try {
      userId = await UsersRepository.create({ email, password, name, phone, role: 'admin', tier: 'Admin' });
    } catch (dbError: unknown) {
      await reportRuntimeIssue({
        source: 'registration',
        operation: 'create_user_failed',
        severity: 'error',
        title: 'New user registration failed',
        error: dbError,
      });
      throw dbError;
    }

    setPendingApplicantCookie({ userId, name: name || '', email });

    return NextResponse.json({
      success: true,
      message: 'Registration successful.',
    });
  } catch (error: unknown) {
    console.error('Register error:', error);
    return NextResponse.json({ success: false, error: 'Registration failed. Please try again.' }, { status: 500 });
  }
}
