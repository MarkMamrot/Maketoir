import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminSession } from '@/lib/sessionUtils';

export async function POST(request: Request) {
  const auth = requireAdminSession();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null) as {
    message?: string;
    name?: string;
    stack?: string;
    digest?: string;
    pathname?: string;
  } | null;
  if (!body?.message?.trim()) {
    return NextResponse.json({ error: 'message is required.' }, { status: 400 });
  }

  const error = new Error(body.message.slice(0, 5_000));
  error.name = String(body.name || 'ClientError').slice(0, 100);
  if (body.stack) error.stack = body.stack.slice(0, 16_000);

  await reportRuntimeIssue({
    businessId: auth.user.businessId,
    source: 'browser',
    operation: 'react_error_boundary',
    title: 'Unhandled browser application error',
    error,
    context: {
      digest: body.digest?.slice(0, 255) || null,
      pathname: body.pathname?.slice(0, 500) || null,
      user_agent: request.headers.get('user-agent')?.slice(0, 500) || null,
    },
  });

  return NextResponse.json({ success: true });
}
