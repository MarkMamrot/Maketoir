import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getImsSession } from '@/lib/auth/imsSession';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    message?: string;
    name?: string;
    stack?: string;
    digest?: string;
    pathname?: string;
    operation?: string;
    businessId?: string;
    localId?: string;
    metrics?: Record<string, unknown>;
  } | null;
  const isSaleRecovery = ['pos_sale_local_storage', 'pos_sale_sync'].includes(body?.operation ?? '');
  const isCatalogueFailure = body?.operation === 'pos_catalogue_refresh';
  const isDeviceIssue = ['pos_terminal_readiness', 'pos_terminal_delay', 'pos_audio_playback'].includes(body?.operation ?? '');
  const isPosOperation = isSaleRecovery || isCatalogueFailure || isDeviceIssue || ['pos_login_cache_write', 'pos_terminal_refund', 'pos_terminal_purchase'].includes(body?.operation ?? '');
  const session = await getImsSession(isPosOperation ? ['pos_session', 'marketoir_session'] : ['marketoir_session', 'pos_session']);
  if (!session?.businessId) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  if (body?.businessId && body.businessId !== session.businessId) {
    return NextResponse.json({ error: 'POS business changed before the issue was reported.' }, { status: 409 });
  }
  if (typeof body?.message !== 'string' || !body.message.trim()) {
    return NextResponse.json({ error: 'message is required.' }, { status: 400 });
  }

  const error = new Error(body.message.slice(0, 5_000));
  error.name = String(body.name || 'ClientError').slice(0, 100);
  if (body.stack) error.stack = body.stack.slice(0, 16_000);

  const isPosCacheFailure = body.operation === 'pos_login_cache_write';
  const isTerminalFailure = body.operation === 'pos_terminal_refund' || body.operation === 'pos_terminal_purchase';
  const timing: Record<string, number | boolean | null> = {};
  if ((isDeviceIssue || isTerminalFailure) && body.metrics !== undefined) {
    if (!body.metrics || typeof body.metrics !== 'object' || Array.isArray(body.metrics)) {
      return NextResponse.json({ error: 'metrics must be an object.' }, { status: 400 });
    }
    for (const key of ['readinessWaitMs', 'readinessCheckMs', 'firstTerminalEventMs', 'resultWaitMs', 'totalMs',
      'longTaskCount', 'longTaskTotalMs', 'maxLongTaskMs', 'maxEventLoopDelayMs', 'jsHeapBytes']) {
      const value = body.metrics[key];
      if (value === undefined) continue;
      if (value === null && ['firstTerminalEventMs', 'resultWaitMs', 'jsHeapBytes'].includes(key)) {
        timing[key] = null;
      } else if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) {
        timing[key] = value;
      } else return NextResponse.json({ error: `Invalid diagnostic metric: ${key}.` }, { status: 400 });
    }
    for (const key of ['readinessCached', 'longTaskSupported', 'pageWasHidden']) {
      if (body.metrics[key] === undefined) continue;
      if (typeof body.metrics[key] !== 'boolean') return NextResponse.json({ error: `Invalid diagnostic metric: ${key}.` }, { status: 400 });
      timing[key] = body.metrics[key];
    }
  }
  await reportRuntimeIssue({
    businessId: session.businessId,
    source: body.operation === 'pos_audio_playback' ? 'pos_audio' : isCatalogueFailure ? 'pos_catalogue' : isSaleRecovery ? 'pos_sale' : isTerminalFailure || isDeviceIssue ? 'pos_terminal' : 'browser',
    operation: isSaleRecovery || isTerminalFailure || isCatalogueFailure || isDeviceIssue ? body.operation! : isPosCacheFailure ? 'pos_login_cache_write' : 'react_error_boundary',
    title: body.operation === 'pos_audio_playback' ? 'POS sound needs device review'
      : body.operation === 'pos_terminal_delay' ? 'POS terminal preparation or browser was slow'
      : body.operation === 'pos_terminal_readiness' ? 'POS terminal readiness could not be confirmed'
      : isCatalogueFailure ? 'POS stock catalogue could not be refreshed' : isSaleRecovery ? 'Paid POS sale requires device recovery' : isTerminalFailure ? `POS terminal ${body.operation === 'pos_terminal_refund' ? 'refund' : 'payment'} failed` : isPosCacheFailure ? 'POS browser cache could not be persisted' : 'Unhandled browser application error',
    error,
    context: {
      digest: body.digest?.slice(0, 255) || null,
      pathname: body.pathname?.slice(0, 500) || null,
      user_agent: request.headers.get('user-agent')?.slice(0, 500) || null,
      ...(Object.keys(timing).length ? { terminal_timing: timing } : {}),
    },
    reference: (isSaleRecovery || isCatalogueFailure) && typeof body.localId === 'string' && body.localId
      ? { type: 'pos_sale_local_id', id: body.localId.slice(0, 255) } : undefined,
  });

  return NextResponse.json({ success: true });
}
