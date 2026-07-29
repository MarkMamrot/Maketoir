import { NextResponse } from 'next/server';
import {
  DEFAULT_FORESIGHT_MARKETING_STRATEGY,
  MarketingStrategyValidationError,
  parseMarketingStrategy,
  renderMarketingStrategyMarkdown,
} from '@/lib/foresight/marketingStrategy';
import { ForesightRepository } from '@/lib/foresight/repositories/ForesightRepository';
import { requireAdminSession, requireAdminTier } from '@/lib/sessionUtils';

export async function GET() {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const latest = await ForesightRepository.latestStrategy(user.businessId);
  return NextResponse.json({
    success: true,
    version: latest?.version ?? 0,
    strategy: latest ? parseMarketingStrategy(latest.strategy_json) : DEFAULT_FORESIGHT_MARKETING_STRATEGY,
    markdown: latest?.markdown_text ?? renderMarketingStrategyMarkdown(DEFAULT_FORESIGHT_MARKETING_STRATEGY),
    changeReason: latest?.change_reason ?? null,
    createdAt: latest?.created_at ?? null,
  });
}

export async function PUT(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const changeReason = typeof body?.changeReason === 'string' ? body.changeReason.trim() : '';
  if (changeReason.length < 3 || changeReason.length > 500) {
    return NextResponse.json(
      { error: 'changeReason must be between 3 and 500 characters.' },
      { status: 400 },
    );
  }

  try {
    const strategy = parseMarketingStrategy(body?.strategy);
    const id = await ForesightRepository.createStrategyVersion(user.businessId, {
      strategy,
      markdown: renderMarketingStrategyMarkdown(strategy),
      authoredBy: user.userId,
      changeReason,
    });
    const latest = await ForesightRepository.latestStrategy(user.businessId);
    return NextResponse.json({ success: true, id, version: latest?.version ?? null, strategy });
  } catch (error) {
    if (error instanceof MarketingStrategyValidationError) {
      return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 });
    }
    throw error;
  }
}