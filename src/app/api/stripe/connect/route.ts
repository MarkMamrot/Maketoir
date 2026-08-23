import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';

import { buildStripeConnectUrl, stripeConnectConfigured } from '@/lib/onlineShop/stripeConnect';
import { signStripeConnectState } from '@/lib/onlineShop/stripeConnectState';
import { requireAdminTier } from '@/lib/sessionUtils';

function appUrl(): string { const raw = process.env.APP_URL ?? 'solvantis.com.au'; return /^https?:\/\//i.test(raw) ? raw.replace(/\/$/, '') : `https://${raw.replace(/\/$/, '')}`; }

export async function GET() {
  const auth = requireAdminTier(); if (auth.response) return auth.response;
  if (!stripeConnectConfigured()) return NextResponse.redirect(`${appUrl()}/ims?view=online-shop&stripeError=${encodeURIComponent('Stripe Connect is not configured.')}`);
  const nonce = randomBytes(24).toString('base64url');
  const state = signStripeConnectState({ businessId: auth.user.businessId, userId: auth.user.userId, nonce, expiresAt: Date.now() + 10 * 60 * 1000 });
  const response = NextResponse.redirect(buildStripeConnectUrl(state));
  response.cookies.set('stripe_connect_nonce', nonce, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/stripe/callback', maxAge: 600 });
  return response;
}