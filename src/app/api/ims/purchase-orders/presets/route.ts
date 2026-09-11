import { NextResponse } from 'next/server';
import { getImsSession, type MarketoirSession } from '@/lib/auth/imsSession';
import { sanitizePurchaseOrderWorkspace } from '@/lib/ims/purchaseOrderWorkspace';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

interface PresetRow {
  id: number | string;
  name: string;
  settings_json: string;
  last_used_at: string | null;
}

function userKey(session: MarketoirSession): string | null {
  if (session.userId != null) return `id:${session.userId}`;
  const email = String(session.email ?? '').trim().toLowerCase();
  return email ? `email:${email}` : null;
}

async function context() {
  const session = await getImsSession();
  if (!session) return { response: NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 }) };
  const key = userKey(session);
  if (!key) return { response: NextResponse.json({ success: false, error: 'A user identity is required for presets.' }, { status: 403 }) };
  return { businessId: String(session.businessId), userKey: key };
}

function serializePreset(row: PresetRow) {
  let raw: unknown = {};
  try { raw = JSON.parse(row.settings_json); } catch { raw = {}; }
  return { id: String(row.id), name: row.name, settings: sanitizePurchaseOrderWorkspace(raw), lastUsedAt: row.last_used_at };
}

export async function GET() {
  const auth = await context();
  if ('response' in auth) return auth.response;
  try {
    const rows = await imsQuery<PresetRow>(
      `SELECT id, name, settings_json, last_used_at FROM ims_purchase_order_presets
        WHERE business_id = ? AND user_key = ? ORDER BY name ASC`,
      [auth.businessId, auth.userKey],
    );
    const presets = rows.map(serializePreset);
    const lastUsedPresetId = [...presets].sort((left, right) => String(right.lastUsedAt ?? '').localeCompare(String(left.lastUsedAt ?? '')))[0]?.id ?? null;
    return NextResponse.json({ success: true, presets, lastUsedPresetId });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.businessId, source: 'ims-purchase-orders', operation: 'purchase_order_presets_list', title: 'Purchase Order presets could not be loaded', error });
    return NextResponse.json({ success: false, error: 'Presets could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await context();
  if ('response' in auth) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON.' }, { status: 400 }); }
  const name = String(body.name ?? '').trim();
  if (!name || name.length > 80) return NextResponse.json({ success: false, error: 'Preset name must be between 1 and 80 characters.' }, { status: 400 });
  const settings = sanitizePurchaseOrderWorkspace(body.settings);
  try {
    await imsExecute(
      `INSERT INTO ims_purchase_order_presets (business_id, user_key, name, settings_json, last_used_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), last_used_at = CURRENT_TIMESTAMP(3)`,
      [auth.businessId, auth.userKey, name, JSON.stringify(settings)],
    );
    const rows = await imsQuery<PresetRow>(
      `SELECT id, name, settings_json, last_used_at FROM ims_purchase_order_presets
        WHERE business_id = ? AND user_key = ? AND name = ? LIMIT 1`,
      [auth.businessId, auth.userKey, name],
    );
    return NextResponse.json({ success: true, preset: serializePreset(rows[0]) });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.businessId, source: 'ims-purchase-orders', operation: 'purchase_order_preset_save', title: 'Purchase Order preset could not be saved', error, context: { nameLength: name.length } });
    return NextResponse.json({ success: false, error: 'Preset could not be saved.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await context();
  if ('response' in auth) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON.' }, { status: 400 }); }
  const presetId = Number(body.presetId);
  if (!Number.isSafeInteger(presetId) || presetId <= 0) return NextResponse.json({ success: false, error: 'Invalid preset.' }, { status: 400 });
  try {
    const result = await imsExecute(
      `UPDATE ims_purchase_order_presets SET last_used_at = CURRENT_TIMESTAMP(3)
        WHERE id = ? AND business_id = ? AND user_key = ?`,
      [presetId, auth.businessId, auth.userKey],
    );
    if (!result.affectedRows) return NextResponse.json({ success: false, error: 'Preset not found.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.businessId, source: 'ims-purchase-orders', operation: 'purchase_order_preset_select', title: 'Purchase Order preset selection could not be saved', error, context: { presetId } });
    return NextResponse.json({ success: false, error: 'Preset selection could not be saved.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await context();
  if ('response' in auth) return auth.response;
  const presetId = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isSafeInteger(presetId) || presetId <= 0) return NextResponse.json({ success: false, error: 'Invalid preset.' }, { status: 400 });
  try {
    const result = await imsExecute(
      `DELETE FROM ims_purchase_order_presets WHERE id = ? AND business_id = ? AND user_key = ?`,
      [presetId, auth.businessId, auth.userKey],
    );
    if (!result.affectedRows) return NextResponse.json({ success: false, error: 'Preset not found.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.businessId, source: 'ims-purchase-orders', operation: 'purchase_order_preset_delete', title: 'Purchase Order preset could not be deleted', error, context: { presetId } });
    return NextResponse.json({ success: false, error: 'Preset could not be deleted.' }, { status: 500 });
  }
}