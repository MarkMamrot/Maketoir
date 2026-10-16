import { NextResponse } from 'next/server';
import type { PoolConnection } from 'mysql2/promise';
import { getImsSession, type MarketoirSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { transaction } from './db';
import { ConsignmentError } from './domain';

export async function consignmentRequest(
  operation: string, admin: boolean,
  handler: (db: PoolConnection, session: MarketoirSession) => Promise<unknown>,
) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  if (admin && !['Admin', 'SuperAdmin'].includes(session.tier ?? '')) return NextResponse.json({ success: false, error: 'Only administrators can change consignment tracking or statements.' }, { status: 403 });
  try {
    const data = await transaction(session.businessId, db => handler(db, session));
    if (data instanceof Response) return data;
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ConsignmentError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    await reportRuntimeIssue({ businessId: session.businessId, source: 'ims.consignment', operation, title: 'Consignment operation failed', error, context: { operation }, reference: { type: 'consignment-operation', id: operation } });
    return NextResponse.json({ success: false, error: 'Consignment operation failed. Please retry or contact support.' }, { status: 500 });
  }
}
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await req.json(); } catch { throw new ConsignmentError('Invalid JSON body.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ConsignmentError('Expected a JSON object.');
  return body as Record<string, unknown>;
}
export function actorId(session: MarketoirSession) { return session.userId ?? session.pos_user_id ?? null; }
