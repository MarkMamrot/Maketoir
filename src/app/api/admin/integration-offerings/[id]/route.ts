import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { getPool, query } from '@/services/MySQLService';
import { mapOffering } from '../route';
import { validateIntegrationOfferingInput } from '../validation';

function offeringId(params: { id: string }): number | null {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const id = offeringId(params);
  if (!id) return NextResponse.json({ error: 'Invalid offering id.' }, { status: 400 });
  try {
    const rows = await query<Record<string, unknown>>('SELECT * FROM sales_integration_offerings WHERE id = ? LIMIT 1', [id]);
    if (!rows[0]) return NextResponse.json({ error: 'Offering not found.' }, { status: 404 });
    return NextResponse.json({ success: true, offering: mapOffering(rows[0]) });
  } catch (error) {
    await reportRuntimeIssue({
      source: 'admin', operation: 'get_integration_offering', title: 'Integration offering failed to load', error,
      context: { offering_id: id }, reference: { type: 'integration_offering', id },
    });
    return NextResponse.json({ error: 'Integration offering could not be loaded.' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const id = offeringId(params);
  if (!id) return NextResponse.json({ error: 'Invalid offering id.' }, { status: 400 });
  const validation = validateIntegrationOfferingInput(await request.json().catch(() => null));
  if (validation.error) return NextResponse.json({ error: validation.error }, { status: 400 });
  const value = validation.value;
  const connection = await getPool().getConnection().catch(async error => {
    await reportRuntimeIssue({
      source: 'admin', operation: 'update_integration_offering', title: 'Integration offering update failed', error,
      context: { offering_id: id }, reference: { type: 'integration_offering', id },
    });
    return null;
  });
  if (!connection) return NextResponse.json({ error: 'Integration offering could not be updated.' }, { status: 500 });
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute('SELECT * FROM sales_integration_offerings WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
    if (!rows[0]) {
      await connection.rollback();
      return NextResponse.json({ error: 'Offering not found.' }, { status: 404 });
    }
    const before = mapOffering(rows[0]);
    await connection.execute(
      `UPDATE sales_integration_offerings
          SET slug = ?, name = ?, category = ?, delivery_mode = ?, public_summary = ?,
              example_providers_json = ?, supported_workflows_json = ?, qualification_questions_json = ?,
              is_enabled = ?, internal_notes = ?
        WHERE id = ?`,
      [value.slug, value.name, value.category, value.deliveryMode, value.publicSummary,
        JSON.stringify(value.exampleProviders), JSON.stringify(value.supportedWorkflows),
        JSON.stringify(value.qualificationQuestions), value.isEnabled ? 1 : 0, value.internalNotes, id],
    );
    const after = { id, ...value };
    await connection.execute(
      `INSERT INTO sales_integration_events
        (idempotency_key, offering_id, event_type, event_data_json)
       VALUES (?, ?, 'admin_updated', ?)`,
      [randomUUID(), id, JSON.stringify({ actor_user_id: auth.user.userId, before, after })],
    );
    await connection.commit();
    return NextResponse.json({ success: true, offering: after });
  } catch (error: any) {
    await connection.rollback().catch(() => {});
    if (error?.code === 'ER_DUP_ENTRY') return NextResponse.json({ error: 'An offering with this slug already exists.' }, { status: 409 });
    await reportRuntimeIssue({
      source: 'admin', operation: 'update_integration_offering', title: 'Integration offering update failed', error,
      context: { offering_id: id, category: value.category, delivery_mode: value.deliveryMode },
      reference: { type: 'integration_offering', id },
    });
    return NextResponse.json({ error: 'Integration offering could not be updated.' }, { status: 500 });
  } finally {
    connection.release();
  }
}