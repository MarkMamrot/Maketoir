import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getImsSession } from '@/lib/auth/imsSession';

export async function POST(request: Request) {
  const session = await getImsSession(['marketoir_session', 'pos_session']);
  if (!session?.businessId) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    message?: string;
    name?: string;
    stack?: string;
    digest?: string;
    pathname?: string;
    operation?: string;
  } | null;
  if (!body?.message?.trim()) {
    return NextResponse.json({ error: 'message is required.' }, { status: 400 });
  }

  const error = new Error(body.message.slice(0, 5_000));
  error.name = String(body.name || 'ClientError').slice(0, 100);
  if (body.stack) error.stack = body.stack.slice(0, 16_000);

  const isPosCacheFailure = body.operation === 'pos_login_cache_write';
  await reportRuntimeIssue({
    businessId: session.businessId,
    source: 'browser',
    operation: isPosCacheFailure ? 'pos_login_cache_write' : 'react_error_boundary',
    title: isPosCacheFailure ? 'POS browser cache could not be persisted' : 'Unhandled browser application error',
    error,
    context: {
      digest: body.digest?.slice(0, 255) || null,
      pathname: body.pathname?.slice(0, 500) || null,
      user_agent: request.headers.get('user-agent')?.slice(0, 500) || null,
    },
  });

  return NextResponse.json({ success: true });
}
