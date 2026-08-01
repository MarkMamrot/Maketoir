import { NextResponse } from 'next/server';
import { ForesightCampaignExperimentResultRepository } from '@/lib/foresight/repositories/ForesightCampaignExperimentResultRepository';
import { requireAdminSession } from '@/lib/sessionUtils';

function threadId(value: string): number | null { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }

export async function GET(_request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminSession(); if (response) return response;
  const id = threadId(context.params.threadId); if (!id) return NextResponse.json({ error: 'Invalid thread id.' }, { status: 400 });
  return NextResponse.json({ success: true, result: await ForesightCampaignExperimentResultRepository.getForThread(user.businessId, id) });
}
