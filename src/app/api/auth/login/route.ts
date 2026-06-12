import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { UsersRepository } from '@/lib/db/UsersRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ success: false, error: 'Email and password are required.' }, { status: 400 });
    }

    const user = await UsersRepository.findByEmail(email);
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found.' }, { status: 404 });
    }

    const valid = await UsersRepository.verifyPassword(user, password);
    if (!valid) {
      return NextResponse.json({ success: false, error: 'Invalid password.' }, { status: 401 });
    }

    const userData = {
      name:              user.name ?? '',
      company:           user.company ?? '',
      email:             user.email,
      userSpreadsheetId: user.business_id ?? '',
    };

    cookies().set('marketoir_session', JSON.stringify(userData), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    // EVENT-DRIVEN CACHE UPDATE: Refresh all variants on login to ensure data is clean for the day.
    // Fire and forget (don't await) so we don't block the login response.
    refreshVariantCache().catch(err => console.error('Failed background cache refresh on login:', err));

    return NextResponse.json({ success: true, message: 'Login successful.', user: userData });
  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
}
