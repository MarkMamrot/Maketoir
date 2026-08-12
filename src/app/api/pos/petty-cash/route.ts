import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_AMOUNT = 5000;
const ALLOWED_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

function readPosSession(): any | null {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function uploadDirectory(businessId: string, operationKey: string): string {
  return path.join(process.env.UPLOAD_BASE_PATH ?? './uploads', businessId, 'PettyCash', operationKey);
}

function gstAmount(amount: number, treatment: string): number {
  return treatment === 'gst' ? Math.round((amount - amount / 1.1) * 100) / 100 : 0;
}

export async function POST(request: Request) {
  const rawSession = readPosSession();
  if (!rawSession?.pos_user_id) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const session = await getImsSession(['pos_session']);
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  let storedPath = '';
  let operationKey = '';
  try {
    const form = await request.formData();
    operationKey = String(form.get('operation_key') ?? '').trim();
    const registerSessionId = Number(form.get('register_session_id'));
    const amount = Math.round(Number(form.get('amount')) * 100) / 100;
    const reason = String(form.get('reason') ?? '').trim();
    const gstTreatment = String(form.get('gst_treatment') ?? 'gst');
    const receipt = form.get('receipt');

    if (!/^[a-zA-Z0-9-]{16,64}$/.test(operationKey)) {
      return NextResponse.json({ error: 'A valid operation key is required.' }, { status: 400 });
    }
    if (!Number.isInteger(registerSessionId) || registerSessionId <= 0) {
      return NextResponse.json({ error: 'An open register session is required.' }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      return NextResponse.json({ error: `Amount must be between $0.01 and $${MAX_AMOUNT.toFixed(2)}.` }, { status: 400 });
    }
    if (!reason || reason.length > 500) {
      return NextResponse.json({ error: 'A reason of up to 500 characters is required.' }, { status: 400 });
    }
    if (!['gst', 'bas_excluded'].includes(gstTreatment)) {
      return NextResponse.json({ error: 'Select a valid GST treatment.' }, { status: 400 });
    }
    if (!(receipt instanceof File)) {
      return NextResponse.json({ error: 'A receipt photo or PDF is required.' }, { status: 400 });
    }
    const expectedExtension = ALLOWED_TYPES.get(receipt.type);
    const suppliedExtension = path.extname(receipt.name).toLowerCase();
    if (!expectedExtension || (receipt.type === 'image/jpeg' ? !['.jpg', '.jpeg'].includes(suppliedExtension) : suppliedExtension !== expectedExtension)) {
      return NextResponse.json({ error: 'Receipt must be a JPG, PNG, WebP, or PDF file.' }, { status: 400 });
    }
    if (receipt.size <= 0 || receipt.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'Receipt must be no larger than 10 MB.' }, { status: 400 });
    }

    const existing = await imsQuery<{ id: number }>(
      'SELECT id FROM pos_petty_cash_transactions WHERE business_id = ? AND operation_key = ? LIMIT 1',
      [session.businessId, operationKey],
    );
    if (existing[0]) return NextResponse.json({ success: true, id: Number(existing[0].id), replayed: true });

    const registerSessions = await imsQuery<{
      id: number; register_id: number; location_id: number; session_date: string; status: string;
    }>(
      `SELECT id, register_id, location_id, session_date, status
         FROM pos_register_sessions WHERE id = ? LIMIT 1`,
      [registerSessionId],
    );
    const registerSession = registerSessions[0];
    if (!registerSession || registerSession.status !== 'open'
      || Number(registerSession.location_id) !== Number(rawSession.location_id)
      || Number(registerSession.register_id) !== Number(rawSession.register_id)) {
      return NextResponse.json({ error: 'Petty cash requires the current open register session.' }, { status: 409 });
    }

    const storedName = `${crypto.randomUUID()}${expectedExtension}`;
    const directory = uploadDirectory(session.businessId, operationKey);
    await fs.mkdir(directory, { recursive: true });
    storedPath = path.join(directory, storedName);
    await fs.writeFile(storedPath, Buffer.from(await receipt.arrayBuffer()), { flag: 'wx' });
    const originalName = path.basename(receipt.name).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 255) || `receipt${expectedExtension}`;
    const result = await imsExecute(
      `INSERT INTO pos_petty_cash_transactions
       (business_id, operation_key, location_id, register_id, register_session_id,
        transaction_date, amount, gst_treatment, gst_amount, reason,
        receipt_original_name, receipt_stored_name, receipt_mime_type, receipt_file_size,
        cashier_id, cashier_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.businessId, operationKey, registerSession.location_id, registerSession.register_id,
        registerSession.id, String(registerSession.session_date).slice(0, 10), amount,
        gstTreatment, gstAmount(amount, gstTreatment), reason, originalName, storedName,
        receipt.type, receipt.size, rawSession.pos_user_id,
        rawSession.full_name ?? rawSession.username ?? 'POS staff',
      ],
    );
    return NextResponse.json({ success: true, id: result.insertId, replayed: false }, { status: 201 });
  } catch (error: any) {
    if (error?.code === 'ER_DUP_ENTRY' && operationKey) {
      if (storedPath) await fs.unlink(storedPath).catch(() => {});
      const existing = await imsQuery<{ id: number }>(
        'SELECT id FROM pos_petty_cash_transactions WHERE business_id = ? AND operation_key = ? LIMIT 1',
        [session.businessId, operationKey],
      ).catch(() => []);
      if (existing[0]) return NextResponse.json({ success: true, id: Number(existing[0].id), replayed: true });
    }
    if (storedPath) await fs.unlink(storedPath).catch(() => {});
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'pos.petty_cash',
      operation: 'record',
      title: 'POS petty cash recording failed',
      error,
      context: { operationKey: operationKey || null, locationId: Number(rawSession.location_id) || null },
    });
    return NextResponse.json({ error: error?.message ?? 'Petty cash could not be recorded.' }, { status: 500 });
  }
}