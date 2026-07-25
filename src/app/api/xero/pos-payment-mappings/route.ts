import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { query, execute } from '@/services/MySQLService';
import { ConfigRepository } from '@/lib/db/ConfigRepository';

type PosMethodMappingRow = {
  payment_method: string;
  xero_account_code: string | null;
  xero_account_name: string | null;
};

const CONFIG_KEY = 'POS_PaymentMethods';

function normalizeMethodName(value: string): string {
  return value.trim().toLowerCase();
}

function extractMethodName(input: unknown): string | null {
  if (typeof input === 'string') {
    const v = input.trim();
    return v ? v : null;
  }
  if (input && typeof input === 'object' && 'name' in input && typeof (input as { name?: unknown }).name === 'string') {
    const v = (input as { name: string }).name.trim();
    return v ? v : null;
  }
  return null;
}

async function ensureTable(): Promise<void> {
  await execute(
    `CREATE TABLE IF NOT EXISTS xero_pos_payment_mappings (
       id BIGINT AUTO_INCREMENT PRIMARY KEY,
       business_id VARCHAR(255) NOT NULL,
       payment_method VARCHAR(255) NOT NULL,
       xero_account_code VARCHAR(20) NOT NULL,
       xero_account_name VARCHAR(255) DEFAULT NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       UNIQUE KEY uq_xero_pos_payment_method (business_id, payment_method),
       INDEX idx_xero_pos_payment_business (business_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    [],
  );
}

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  if (!databaseId) {
    return NextResponse.json({ success: false, error: 'databaseId is required' }, { status: 400 });
  }

  try {
    await ensureTable();

    const rawMethods = await ConfigRepository.get(databaseId, CONFIG_KEY);
    const parsedMethods = rawMethods ? JSON.parse(rawMethods) : [];
    const names = Array.isArray(parsedMethods)
      ? parsedMethods.map(extractMethodName).filter((v): v is string => !!v)
      : [];

    const seen = new Set<string>();
    const dedupedNames: string[] = [];
    for (const name of names) {
      const key = normalizeMethodName(name);
      if (seen.has(key)) continue;
      seen.add(key);
      dedupedNames.push(name);
    }

    const rows = await query<PosMethodMappingRow>(
      `SELECT payment_method, xero_account_code, xero_account_name
       FROM xero_pos_payment_mappings
       WHERE business_id = ?`,
      [databaseId],
    );

    const mappingByMethod = new Map<string, PosMethodMappingRow>();
    for (const row of rows) {
      mappingByMethod.set(normalizeMethodName(row.payment_method), row);
    }

    const methods = dedupedNames.map(name => {
      const mapped = mappingByMethod.get(normalizeMethodName(name));
      return {
        payment_method: name,
        xero_account_code: mapped?.xero_account_code ?? null,
        xero_account_name: mapped?.xero_account_name ?? null,
      };
    });

    return NextResponse.json({ success: true, methods });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? 'Failed to load POS payment mappings' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const body = await req.json();
  const {
    databaseId,
    paymentMethod,
    xeroAccountCode,
    xeroAccountName,
  } = body as {
    databaseId?: string;
    paymentMethod?: string;
    xeroAccountCode?: string;
    xeroAccountName?: string;
  };

  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  if (!databaseId) {
    return NextResponse.json({ success: false, error: 'databaseId is required' }, { status: 400 });
  }
  if (!paymentMethod || !paymentMethod.trim()) {
    return NextResponse.json({ success: false, error: 'paymentMethod is required' }, { status: 400 });
  }

  try {
    await ensureTable();

    const cleanMethod = paymentMethod.trim();
    const cleanCode = (xeroAccountCode ?? '').trim();
    const cleanName = (xeroAccountName ?? '').trim();

    if (!cleanCode) {
      await execute(
        `DELETE FROM xero_pos_payment_mappings
         WHERE business_id = ? AND payment_method = ?`,
        [databaseId, cleanMethod],
      );
      return NextResponse.json({ success: true, removed: true });
    }

    await execute(
      `INSERT INTO xero_pos_payment_mappings (business_id, payment_method, xero_account_code, xero_account_name)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         xero_account_code = VALUES(xero_account_code),
         xero_account_name = VALUES(xero_account_name),
         updated_at = NOW()`,
      [databaseId, cleanMethod, cleanCode, cleanName || null],
    );

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? 'Failed to save POS payment mapping' }, { status: 500 });
  }
}