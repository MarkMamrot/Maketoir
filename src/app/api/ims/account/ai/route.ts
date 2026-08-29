import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { AiAccountRepository } from '@/lib/ai/billing/accountRepository';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const detail = await AiAccountRepository.tenantDetail(session.businessId);
  if (!detail) return NextResponse.json({ error: 'AI account is not configured.' }, { status: 404 });
  return NextResponse.json(detail);
}