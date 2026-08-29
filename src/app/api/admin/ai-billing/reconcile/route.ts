import { NextResponse } from 'next/server';
import { reconcileAiBilling } from '@/lib/ai/billing/reconciliation';
import { requireSuperAdminTier } from '@/lib/sessionUtils';

export async function GET() { const auth=requireSuperAdminTier(); if(auth.response)return auth.response; return NextResponse.json({ findings: await reconcileAiBilling() }); }