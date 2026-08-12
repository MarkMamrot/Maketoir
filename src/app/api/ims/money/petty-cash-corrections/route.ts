import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requirePosManagerTier } from '@/lib/sessionUtils';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { execute, query } from '@/services/MySQLService';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

function uploadDirectory(businessId: string, operationKey: string): string {
  return path.join(process.env.UPLOAD_BASE_PATH ?? './uploads', businessId, 'PettyCash', operationKey);
}

function actionKey(businessId: string, reconciliationId: number): string {
  return crypto.createHash('sha256').update(`${businessId}|pos-cash-eod|${reconciliationId}|petty-cash`).digest('hex');
}

export async function POST(request: Request) {
  const auth = requirePosManagerTier();
  if (auth.response) return auth.response;
  if (!['Admin', 'SuperAdmin'].includes(auth.user.tier)) {
    return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  }
  const session = await getImsSession();
  if (!session || session.businessId !== auth.user.businessId) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }

  let storedPath = '';
  let operationKey = '';
  try {
    const form = await request.formData();
    operationKey = String(form.get('operation_key') ?? '').trim();
    const reconciliationId = Number(form.get('reconciliation_id'));
    const amount = Math.round(Number(form.get('amount')) * 100) / 100;
    const reason = String(form.get('reason') ?? '').trim();
    const gstTreatment = String(form.get('gst_treatment') ?? 'gst');
    const receipt = form.get('receipt');
    const noReceiptAttestation = String(form.get('no_receipt_attestation') ?? '') === 'true';
    if (!/^[a-zA-Z0-9-]{16,64}$/.test(operationKey)
      || !Number.isInteger(reconciliationId) || reconciliationId <= 0
      || !Number.isFinite(amount) || amount <= 0
      || !reason || reason.length > 500
      || !['gst', 'bas_excluded'].includes(gstTreatment)
      || (!(receipt instanceof File) && !noReceiptAttestation)) {
      return NextResponse.json({ error: 'Reconciliation, amount, reason, GST treatment, receipt, and operation key are required.' }, { status: 400 });
    }
    let expectedExtension = '';
    if (receipt instanceof File) {
      expectedExtension = ALLOWED_TYPES.get(receipt.type) ?? '';
      const suppliedExtension = path.extname(receipt.name).toLowerCase();
      if (!expectedExtension || (receipt.type === 'image/jpeg' ? !['.jpg', '.jpeg'].includes(suppliedExtension) : suppliedExtension !== expectedExtension)) {
        return NextResponse.json({ error: 'Receipt must be a JPG, PNG, WebP, or PDF file.' }, { status: 400 });
      }
      if (receipt.size <= 0 || receipt.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'Receipt must be no larger than 10 MB.' }, { status: 400 });
      }
    }

    const reconciliations = await imsQuery<{
      id: number; location_id: number; register_id: number | null; register_session_id: number | null;
      recon_date: string; payment_method: string; counted_amount: number | string | null;
    }>(
      `SELECT r.id, r.location_id, r.register_id, r.register_session_id, r.recon_date,
              r.payment_method, r.counted_amount
         FROM pos_eod_reconciliations r
         JOIN ims_locations l ON l.id = r.location_id AND l.business_id = ?
        WHERE r.id = ? LIMIT 1`,
      [auth.user.businessId, reconciliationId],
    );
    const reconciliation = reconciliations[0];
    if (!reconciliation || reconciliation.payment_method.trim().toLowerCase() !== 'cash'
      || reconciliation.counted_amount == null || !reconciliation.register_session_id) {
      return NextResponse.json({ error: 'A counted Cash register reconciliation is required.' }, { status: 409 });
    }
    const existingTransactions = await imsQuery<{ id: number; operation_key: string }>(
      `SELECT id, operation_key FROM pos_petty_cash_transactions
        WHERE business_id = ? AND register_session_id = ? AND status = 'recorded'`,
      [auth.user.businessId, reconciliation.register_session_id],
    );
    const replay = existingTransactions.find(row => row.operation_key === operationKey);
    if (existingTransactions.length > 0 && !replay) {
      return NextResponse.json({ error: 'This reconciliation already has recorded petty cash and cannot use the historical correction.' }, { status: 409 });
    }

    const plans = await query<{
      petty_cash_amount: number | string; till_variance: number | string;
      payment_status: string; xero_variance_id: string | null;
    }>(
      `SELECT petty_cash_amount, till_variance, payment_status, xero_variance_id
         FROM xero_pos_cash_eod_actions
        WHERE business_id = ? AND eod_reconciliation_id = ? LIMIT 1`,
      [auth.user.businessId, reconciliationId],
    );
    const plan = plans[0];
    if (!plan || plan.payment_status !== 'completed' || plan.xero_variance_id) {
      return NextResponse.json({ error: 'The paid cash plan is not eligible for petty cash correction.' }, { status: 409 });
    }
    const currentPettyCash = Math.round(Number(plan.petty_cash_amount ?? 0) * 100) / 100;
    const currentVariance = Math.round(Number(plan.till_variance ?? 0) * 100) / 100;
    if (currentPettyCash === 0 && (currentVariance >= 0 || amount - Math.abs(currentVariance) > 0.005)) {
      return NextResponse.json({ error: 'Correction amount cannot exceed the negative till variance.' }, { status: 409 });
    }
    if (currentPettyCash !== 0 && Math.abs(currentPettyCash - amount) > 0.005) {
      return NextResponse.json({ error: 'This reconciliation already has a different petty cash correction.' }, { status: 409 });
    }
    const clearingMappings = await query<{ xero_account_code: string }>(
      `SELECT xero_account_code
         FROM xero_pos_clearing_mappings
        WHERE business_id = ? AND ims_location_id = ? AND payment_method = 'Cash'
        LIMIT 1`,
      [auth.user.businessId, reconciliation.location_id],
    );
    const clearingAccountCode = String(clearingMappings[0]?.xero_account_code ?? '').trim();
    if (!clearingAccountCode) {
      return NextResponse.json({ error: 'The location requires a current Xero Cash clearing mapping.' }, { status: 409 });
    }

    let transactionId = Number(replay?.id ?? 0);
    if (!transactionId) {
      const hasReceipt = receipt instanceof File;
      const storedName = hasReceipt ? `${crypto.randomUUID()}${expectedExtension}` : '';
      if (hasReceipt) {
        const directory = uploadDirectory(auth.user.businessId, operationKey);
        await fs.mkdir(directory, { recursive: true });
        storedPath = path.join(directory, storedName);
        await fs.writeFile(storedPath, Buffer.from(await receipt.arrayBuffer()), { flag: 'wx' });
      }
      const originalName = hasReceipt
        ? path.basename(receipt.name).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 255) || `receipt${expectedExtension}`
        : 'No receipt - admin attestation';
      const gstAmount = gstTreatment === 'gst' ? Math.round((amount - amount / 1.1) * 100) / 100 : 0;
      const result = await imsExecute(
        `INSERT INTO pos_petty_cash_transactions
         (business_id, operation_key, location_id, register_id, register_session_id,
          transaction_date, amount, gst_treatment, gst_amount, reason, evidence_type, evidence_note,
          receipt_original_name, receipt_stored_name, receipt_mime_type, receipt_file_size,
          cashier_id, cashier_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          auth.user.businessId, operationKey, reconciliation.location_id, reconciliation.register_id,
          reconciliation.register_session_id, String(reconciliation.recon_date).slice(0, 10), amount,
          gstTreatment, gstAmount, reason, hasReceipt ? 'receipt' : 'admin_attestation',
          hasReceipt ? null : `Historical correction approved without receipt by ${auth.user.name}`,
          originalName, storedName, hasReceipt ? receipt.type : 'application/x-admin-attestation', hasReceipt ? receipt.size : 0,
          auth.user.userId, auth.user.name,
        ],
      );
      transactionId = Number(result.insertId);
      storedPath = '';
    }

    if (currentPettyCash === 0) {
      const update = await execute(
        `UPDATE xero_pos_cash_eod_actions
            SET accounting_version = 3,
                expected_amount = expected_amount - ?,
                petty_cash_amount = ?,
                variance_status = IF(ABS(till_variance + ?) < 0.005, 'not_required', 'pending'),
                till_variance = till_variance + ?,
                clearing_account_code = ?,
                petty_cash_status = 'pending', petty_cash_idempotency_key = ?,
                error_detail = NULL, completed_at = NULL
          WHERE business_id = ? AND eod_reconciliation_id = ?
            AND petty_cash_amount = 0 AND xero_petty_cash_id IS NULL`,
        [amount, amount, amount, amount, clearingAccountCode, actionKey(auth.user.businessId, reconciliationId), auth.user.businessId, reconciliationId],
      );
      if (!update.affectedRows) {
        const latest = await query<{ petty_cash_amount: number | string }>(
          'SELECT petty_cash_amount FROM xero_pos_cash_eod_actions WHERE business_id = ? AND eod_reconciliation_id = ? LIMIT 1',
          [auth.user.businessId, reconciliationId],
        );
        if (Math.abs(Number(latest[0]?.petty_cash_amount ?? 0) - amount) > 0.005) {
          throw new Error('The cash plan changed while the correction was being recorded.');
        }
      }
    }
    return NextResponse.json({ success: true, transactionId, reconciliationId, replayed: !!replay });
  } catch (error: any) {
    if (storedPath) await fs.unlink(storedPath).catch(() => {});
    await reportRuntimeIssue({
      businessId: auth.user.businessId,
      source: 'ims.cash_banking',
      operation: 'petty-cash-correction',
      title: 'Historical petty cash correction failed',
      error,
      context: { operationKey: operationKey || null },
    });
    return NextResponse.json({ error: error?.message ?? 'Petty cash correction failed.' }, { status: 500 });
  }
}