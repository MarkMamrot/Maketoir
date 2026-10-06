import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';

import { runProspectConversationMaintenance } from '@/lib/salesAssistant/retention';

export const runtime = 'nodejs';
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const cronSecret = request.headers.get('x-cron-secret') || '';
  const authorization = request.headers.get('authorization') || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const candidate = cronSecret || supplied;
  if (!secret || !candidate) return false;
  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(candidate);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

async function handle(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  try {
    return NextResponse.json(await runProspectConversationMaintenance());
  } catch {
    return NextResponse.json({ error: 'Prospect conversation maintenance failed.' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
