import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { diagnoseCreativePerformance } from '@/lib/foresight/creative/creativeDiagnostics';
import { ForesightCreativeRepository } from '@/lib/foresight/repositories/ForesightCreativeRepository';

function isoDate(value: string | null): value is string {
  return value != null && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const throughDate = new URL(request.url).searchParams.get('through');
  if (!isoDate(throughDate)) {
    return NextResponse.json({ error: 'through must be a valid complete-day YYYY-MM-DD date.' }, { status: 400 });
  }
  const startDate = addDays(throughDate, -13);
  const creatives = await ForesightCreativeRepository.listDiagnosticInputs(
    user.businessId, startDate, throughDate, 100,
  );
  return NextResponse.json({ success: true, diagnostics: diagnoseCreativePerformance({ throughDate, creatives }) });
}
