import { NextResponse } from 'next/server';
import { ImsContactsRepo } from '@/lib/ims/ImsRepository';
import { imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

let migrationDone = false;
async function ensureMigration() {
  if (migrationDone) return;
  // Legacy column
  await imsExecute(`ALTER TABLE ims_contacts ADD COLUMN IF NOT EXISTS order_frequency_days INT NOT NULL DEFAULT 45`).catch(() => {});
  // Expand ENUM
  await imsExecute(`ALTER TABLE ims_contacts MODIFY COLUMN type ENUM('supplier','customer','b2b_customer','retail_customer','lead','both') NOT NULL DEFAULT 'supplier'`).catch(() => {});
  await imsExecute(`UPDATE ims_contacts SET type = 'b2b_customer' WHERE type = 'customer'`).catch(() => {});
  // New columns — check existence first (ADD COLUMN IF NOT EXISTS not universally supported)
  const newCols: [string, string][] = [
    ['first_name',       'VARCHAR(100) DEFAULT NULL'],
    ['last_name',        'VARCHAR(100) DEFAULT NULL'],
    ['customer_code',    'VARCHAR(100) DEFAULT NULL'],
    ['customer_group',   'VARCHAR(100) DEFAULT NULL'],
    ['mobile',           'VARCHAR(50) DEFAULT NULL'],
    ['address2',         'VARCHAR(255) DEFAULT NULL'],
    ['suburb',           'VARCHAR(100) DEFAULT NULL'],
    ['store_credit',     'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
    ['on_account_limit', 'DECIMAL(10,2) DEFAULT NULL'],
    ['date_of_birth',    'DATE DEFAULT NULL'],
    ['gender',           'VARCHAR(10) DEFAULT NULL'],
    ['promo_email',      'TINYINT(1) NOT NULL DEFAULT 0'],
    ['promo_sms',        'TINYINT(1) NOT NULL DEFAULT 0'],
  ];
  const existingCols = await imsQuery<{ Field: string }>('SHOW COLUMNS FROM ims_contacts').catch(() => [] as { Field: string }[]);
  const colSet = new Set(existingCols.map((c: { Field: string }) => c.Field));
  for (const [col, def] of newCols) {
    if (!colSet.has(col)) {
      await imsExecute(`ALTER TABLE ims_contacts ADD COLUMN ${col} ${def}`).catch(() => {});
    }
  }
  // Unique index on customer_code per business
  await imsExecute(`ALTER TABLE ims_contacts ADD UNIQUE INDEX idx_customer_code (business_id, customer_code)`).catch(() => {});
  migrationDone = true;
}

export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    await ensureMigration();
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') as any ?? undefined;
    const activeOnly = searchParams.get('active') === '1';
    const data = await ImsContactsRepo.list(type, activeOnly, businessId);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const body = await req.json();
    const id = await ImsContactsRepo.create(body, businessId);
    return NextResponse.json({ success: true, id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
