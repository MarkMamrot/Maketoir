import { NextResponse } from 'next/server';
import { AiAccountRepository } from '@/lib/ai/billing/accountRepository';
import { requireSuperAdminTier } from '@/lib/sessionUtils';

export async function GET(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  return NextResponse.json({ accounts: await AiAccountRepository.adminSummary(url.searchParams.get('from') || undefined, url.searchParams.get('to') || undefined) });
}