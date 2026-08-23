import { randomUUID } from 'crypto';
import type { ResultSetHeader } from 'mysql2/promise';
import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { getPool, query } from '@/services/MySQLService';
import { OFFERING_CATEGORIES, OFFERING_DELIVERY_MODES, validateIntegrationOfferingInput } from './validation';

function parseArray(value: unknown): string[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function mapOffering(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    name: String(row.name),
    category: String(row.category),
    deliveryMode: String(row.delivery_mode),
    publicSummary: String(row.public_summary),
    exampleProviders: parseArray(row.example_providers_json),
    supportedWorkflows: parseArray(row.supported_workflows_json),
    qualificationQuestions: parseArray(row.qualification_questions_json),
    isEnabled: Boolean(row.is_enabled),
    internalNotes: row.internal_notes == null ? null : String(row.internal_notes),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const category = url.searchParams.get('category') || '';
  const deliveryMode = url.searchParams.get('deliveryMode') || '';
  const enabled = url.searchParams.get('enabled') || '';
  const search = url.searchParams.get('search')?.trim() || '';
  if (category && !OFFERING_CATEGORIES.includes(category as typeof OFFERING_CATEGORIES[number])) {
    return NextResponse.json({ error: 'Invalid category filter.' }, { status: 400 });
  }
  if (deliveryMode && !OFFERING_DELIVERY_MODES.includes(deliveryMode as typeof OFFERING_DELIVERY_MODES[number])) {
    return NextResponse.json({ error: 'Invalid delivery mode filter.' }, { status: 400 });
  }
  if (enabled && enabled !== 'true' && enabled !== 'false') {
    return NextResponse.json({ error: 'enabled must be true or false.' }, { status: 400 });
  }
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (category) { conditions.push('category = ?'); params.push(category); }
  if (deliveryMode) { conditions.push('delivery_mode = ?'); params.push(deliveryMode); }
  if (enabled) { conditions.push('is_enabled = ?'); params.push(enabled === 'true' ? 1 : 0); }
  if (search) {
    conditions.push('(name LIKE ? OR slug LIKE ? OR public_summary LIKE ?)');
    const needle = `%${search.slice(0, 100)}%`;
    params.push(needle, needle, needle);
  }
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT * FROM sales_integration_offerings
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY category, name`,
      params,
    );
    return NextResponse.json({ success: true, offerings: rows.map(mapOffering) });
  } catch (error) {
    await reportRuntimeIssue({
      source: 'admin', operation: 'list_integration_offerings', title: 'Integration offerings failed to load', error,
      context: { category, delivery_mode: deliveryMode, enabled, has_search: Boolean(search) },
    });
    return NextResponse.json({ error: 'Integration offerings could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const validation = validateIntegrationOfferingInput(await request.json().catch(() => null));
  if (validation.error) return NextResponse.json({ error: validation.error }, { status: 400 });
  const value = validation.value;
  const connection = await getPool().getConnection().catch(async error => {
    await reportRuntimeIssue({ source: 'admin', operation: 'create_integration_offering', title: 'Integration offering creation failed', error });
    return null;
  });
  if (!connection) return NextResponse.json({ error: 'Integration offering could not be created.' }, { status: 500 });
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO sales_integration_offerings
        (slug, name, category, delivery_mode, public_summary, example_providers_json,
         supported_workflows_json, qualification_questions_json, is_enabled, internal_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.slug, value.name, value.category, value.deliveryMode, value.publicSummary,
        JSON.stringify(value.exampleProviders), JSON.stringify(value.supportedWorkflows),
        JSON.stringify(value.qualificationQuestions), value.isEnabled ? 1 : 0, value.internalNotes],
    );
    const after = { id: Number(result.insertId), ...value };
    await connection.execute(
      `INSERT INTO sales_integration_events
        (idempotency_key, offering_id, event_type, event_data_json)
       VALUES (?, ?, 'admin_created', ?)`,
      [randomUUID(), after.id, JSON.stringify({ actor_user_id: auth.user.userId, before: null, after })],
    );
    await connection.commit();
    return NextResponse.json({ success: true, offering: after }, { status: 201 });
  } catch (error: unknown) {
    await connection.rollback().catch(() => {});
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'An offering with this slug already exists.' }, { status: 409 });
    }
    await reportRuntimeIssue({
      source: 'admin', operation: 'create_integration_offering', title: 'Integration offering creation failed', error,
      context: { slug: value.slug, category: value.category, delivery_mode: value.deliveryMode },
    });
    return NextResponse.json({ error: 'Integration offering could not be created.' }, { status: 500 });
  } finally {
    connection.release();
  }
}