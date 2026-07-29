import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { ForesightMetricsService } from '@/lib/foresight/ForesightMetricsService';
import { ForesightIngestionRepository } from '@/lib/foresight/repositories/ForesightIngestionRepository';

function isIsoDate(value: string | null): value is string {
  return value != null && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export async function GET(request: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('from');
  const endDate = searchParams.get('to');
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return NextResponse.json({ error: 'from and to must be valid YYYY-MM-DD dates.' }, { status: 400 });
  }
  const daySpan = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
  if (daySpan < 0 || daySpan > 366) {
    return NextResponse.json({ error: 'Date range must be between 0 and 366 days.' }, { status: 400 });
  }

  const [metrics, recentRuns] = await Promise.all([
    ForesightMetricsService.getDailyMarketingMetrics(user.businessId, startDate, endDate),
    ForesightIngestionRepository.listRecentSyncRuns(user.businessId, 10),
  ]);

  return NextResponse.json({
    success: true,
    from: startDate,
    to: endDate,
    ...metrics,
    recentRuns,
  });
}