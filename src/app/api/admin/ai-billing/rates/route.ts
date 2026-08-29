import { NextResponse } from 'next/server';
import { AiRateRepository } from '@/lib/ai/billing/rateRepository';
import { requireSuperAdminTier } from '@/lib/sessionUtils';

export async function GET() { const auth=requireSuperAdminTier(); if(auth.response)return auth.response; return NextResponse.json(await AiRateRepository.list()); }
export async function POST(request: Request) { const auth=requireSuperAdminTier(); if(auth.response)return auth.response; try { return NextResponse.json({ success: await AiRateRepository.add(await request.json(), auth.user.userId) }); } catch(error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Rate creation failed.' }, { status: 400 }); } }