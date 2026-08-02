import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { ForesightCreativeRepository } from '@/lib/foresight/repositories/ForesightCreativeRepository';

export async function GET(request: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const requested = Number(new URL(request.url).searchParams.get('limit') ?? 100);
  const limit = Number.isInteger(requested) ? requested : 100;
  const creatives = await ForesightCreativeRepository.list(user.businessId, limit);
  return NextResponse.json({ success: true, creatives });
}
