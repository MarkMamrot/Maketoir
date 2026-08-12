import fs from 'node:fs/promises';
import path from 'node:path';
import { cookies } from 'next/headers';

import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

function readPosSession(): any | null {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const rawSession = readPosSession();
  if (!rawSession) return new Response('Unauthorised', { status: 401 });
  const session = await getImsSession(['pos_session']);
  if (!session) return new Response('Unauthorised', { status: 401 });
  const transactionId = Number(params.id);
  if (!Number.isInteger(transactionId) || transactionId <= 0) return new Response('Invalid receipt', { status: 400 });

  try {
    const rows = await imsQuery<{
      business_id: string; location_id: number; operation_key: string; receipt_original_name: string;
      receipt_stored_name: string; receipt_mime_type: string;
    }>(
      `SELECT business_id, location_id, operation_key, receipt_original_name,
              receipt_stored_name, receipt_mime_type
         FROM pos_petty_cash_transactions
        WHERE id = ? AND business_id = ? LIMIT 1`,
      [transactionId, session.businessId],
    );
    const receipt = rows[0];
    if (!receipt) return new Response('Not found', { status: 404 });
    if (Number(receipt.location_id) !== Number(rawSession.location_id)) return new Response('Forbidden', { status: 403 });
    const safeStoredName = path.basename(receipt.receipt_stored_name);
    if (safeStoredName !== receipt.receipt_stored_name) return new Response('Invalid receipt', { status: 400 });
    const filePath = path.join(
      process.env.UPLOAD_BASE_PATH ?? './uploads',
      session.businessId,
      'PettyCash',
      receipt.operation_key,
      safeStoredName,
    );
    const bytes = await fs.readFile(filePath);
    const safeName = receipt.receipt_original_name.replace(/["\r\n]/g, '_');
    return new Response(bytes, {
      headers: {
        'Content-Type': receipt.receipt_mime_type,
        'Content-Disposition': `inline; filename="${safeName}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error: any) {
    if (error?.code === 'ENOENT') return new Response('File not found', { status: 404 });
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'pos.petty_cash',
      operation: 'download-receipt',
      title: 'POS petty cash receipt download failed',
      error,
      context: { transactionId },
    });
    return new Response('Receipt download failed', { status: 500 });
  }
}