/**
 * GET  /api/dashboard/creative-summary  — fetch current brief + pending word count
 * POST /api/dashboard/creative-summary  — manual overwrite of summary text
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query, execute } from '@/services/MySQLService';

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export async function GET(req: Request) {
  const sessionCookie = cookies().get('marketoir_session');
  if (!sessionCookie?.value) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const databaseId = new URL(req.url).searchParams.get('databaseId') ?? '';
  if (!databaseId) return NextResponse.json({ error: 'databaseId required' }, { status: 400 });

  const rows = await query<{ summary: string | null; pending_buffer: string | null; updated_at: string }>(
    'SELECT summary, pending_buffer, updated_at FROM creative_summaries WHERE business_id = ?',
    [databaseId],
  );
  const row = rows[0];
  return NextResponse.json({
    summary:      row?.summary ?? '',
    pendingWords: wordCount(row?.pending_buffer ?? ''),
    updatedAt:    row?.updated_at ?? null,
  });
}

export async function POST(req: Request) {
  const sessionCookie = cookies().get('marketoir_session');
  if (!sessionCookie?.value) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { databaseId, summary } = await req.json();
  if (!databaseId) return NextResponse.json({ error: 'databaseId required' }, { status: 400 });

  await execute(
    `INSERT INTO creative_summaries (business_id, summary) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE summary = VALUES(summary), updated_at = NOW()`,
    [databaseId, (summary ?? '').trim()],
  );
  return NextResponse.json({ success: true });
}
