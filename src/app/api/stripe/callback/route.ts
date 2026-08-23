import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { exchangeStripeConnectCode, OnlineShopStripeConnectionRepository } from '@/lib/onlineShop/stripeConnect';
import { verifyStripeConnectState } from '@/lib/onlineShop/stripeConnectState';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getAdminSession } from '@/lib/sessionUtils';

function appUrl(): string { const raw = process.env.APP_URL ?? 'solvantis.com.au'; return /^https?:\/\//i.test(raw) ? raw.replace(/\/$/, '') : `https://${raw.replace(/\/$/, '')}`; }
function redirect(message: string, success = false) { return NextResponse.redirect(`${appUrl()}/ims?view=online-shop&${success ? 'stripeSuccess' : 'stripeError'}=${encodeURIComponent(message)}`); }

export async function GET(request: Request) {
  const url = new URL(request.url); const session = getAdminSession(); const state = verifyStripeConnectState(url.searchParams.get('state') ?? '');
  const nonce = cookies().get('stripe_connect_nonce')?.value;
  if (!session || !state || state.businessId !== session.businessId || state.userId !== session.userId || state.nonce !== nonce) {
    const response = redirect('Stripe authorisation session expired or was invalid.'); response.cookies.delete('stripe_connect_nonce'); return response;
  }
  if (url.searchParams.get('error')) return redirect(url.searchParams.get('error_description') || 'Stripe access was denied.');
  const code = url.searchParams.get('code'); if (!code) return redirect('Stripe did not return an authorisation code.');
  try {
    const account = await exchangeStripeConnectCode(code);
    await OnlineShopStripeConnectionRepository.saveAccount(session.businessId, account, session.userId);
    const response = redirect(account.charges_enabled ? 'Stripe connected.' : 'Stripe connected. Complete account setup in Stripe before taking payments.', true);
    response.cookies.delete('stripe_connect_nonce'); return response;
  } catch (error) {
    await reportRuntimeIssue({ businessId: session.businessId, source: 'online_shop_stripe', operation: 'connect', title: 'Stripe Connect onboarding failed', error }).catch(() => {});
    const response = redirect('Stripe could not be connected.'); response.cookies.delete('stripe_connect_nonce'); return response;
  }
}