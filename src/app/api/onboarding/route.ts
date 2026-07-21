import { NextResponse } from 'next/server';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { BusinessInfoRepository } from '@/lib/db/BusinessInfoRepository';

const PROGRESS_KEY = 'onboarding_completed_steps';

const SETTING_DEFAULTS: Record<string, string> = {
  use_multiple_locations: 'yes',
  use_zones_bins: 'no',
  use_categories: 'no',
  use_foreign_currencies: 'yes',
  connect_online_shop: 'no',
  online_shop_platform: 'shopify',
  connect_accounting_software: 'no',
  accounting_software: 'xero',
  sales_tax_on_sales: 'yes',
  sales_tax_rate: '0.1',
  sales_tax_code: 'GST',
  purchase_tax_rate: '0.1',
  purchase_tax_code: 'GST on Purchases',
};

function parseCompleted(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
}

async function countMain(sql: string, params: unknown[]) {
  const rows = await query<{ c: number }>(sql, params).catch(() => [{ c: 0 }]);
  return Number(rows[0]?.c ?? 0);
}

async function countIms(sql: string, params: unknown[] = []) {
  const rows = await imsQuery<{ c: number }>(sql, params).catch(() => [{ c: 0 }]);
  return Number(rows[0]?.c ?? 0);
}

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const businessId = session.businessId;
  const [settingsRows, businessInfo, counts] = await Promise.all([
    imsQuery<{ key: string; value: string }>('SELECT `key`, value FROM ims_settings WHERE business_id = ?', [businessId]),
    BusinessInfoRepository.get(businessId).catch(() => null),
    Promise.all([
      countMain('SELECT COUNT(*) AS c FROM users WHERE business_id = ? AND deleted_at IS NULL', [businessId]),
      countIms('SELECT COUNT(*) AS c FROM ims_locations WHERE business_id = ? AND is_active = 1', [businessId]),
      countIms('SELECT COUNT(*) AS c FROM ims_products WHERE business_id = ? AND is_active = 1', [businessId]),
      countIms('SELECT COUNT(*) AS c FROM ims_sales_orders WHERE business_id = ?', [businessId]),
      countIms('SELECT COUNT(*) AS c FROM ims_purchase_orders WHERE business_id = ?', [businessId]),
      countIms('SELECT COUNT(*) AS c FROM ims_stock WHERE qty_on_hand <> 0 OR qty_incoming <> 0'),
    ]),
  ]);

  const settings = { ...SETTING_DEFAULTS };
  for (const row of settingsRows) settings[row.key] = row.value ?? '';
  if (!settings.business_name && businessInfo?.brand_name) settings.business_name = businessInfo.brand_name;
  if (!settings.business_abn && businessInfo?.abn) settings.business_abn = businessInfo.abn;

  const completed = new Set(parseCompleted(settings[PROGRESS_KEY]));
  const [userCount, locationCount, productCount, salesOrderCount, purchaseOrderCount, stockCount] = counts;

  const autoDone: Record<string, boolean> = {
    business_profile: Boolean(settings.business_name?.trim() && settings.business_abn?.trim()),
    operations_tax: Boolean(
      settings.use_multiple_locations && settings.use_zones_bins && settings.use_categories &&
      settings.use_foreign_currencies && settings.connect_online_shop && settings.connect_accounting_software &&
      settings.sales_tax_on_sales && settings.sales_tax_rate && settings.purchase_tax_rate
    ),
    users: userCount > 1,
    locations: locationCount > 0,
    products: productCount > 0,
    sales_orders: salesOrderCount > 0,
    purchase_orders: purchaseOrderCount > 0,
    opening_stock: stockCount > 0,
  };

  const steps = [
    { id: 'business_profile', title: 'Confirm business profile', autoCompleted: autoDone.business_profile },
    { id: 'operations_tax', title: 'Confirm operations and tax settings', autoCompleted: autoDone.operations_tax },
    { id: 'online_shop', title: 'Connect online shop', autoCompleted: settings.connect_online_shop === 'no' || Boolean(settings.shopify_order_sync_enabled === '1' || completed.has('online_shop')) },
    { id: 'accounting', title: 'Connect accounting software', autoCompleted: settings.connect_accounting_software === 'no' || completed.has('accounting') },
    { id: 'users', title: 'Add additional users', autoCompleted: autoDone.users },
    { id: 'locations', title: 'Add locations', autoCompleted: autoDone.locations },
    { id: 'products', title: 'Import products', autoCompleted: autoDone.products },
    { id: 'sales_orders', title: 'Import sales orders', autoCompleted: autoDone.sales_orders },
    { id: 'purchase_orders', title: 'Import purchase orders', autoCompleted: autoDone.purchase_orders },
    { id: 'opening_stock', title: 'Make opening stock adjustments', autoCompleted: autoDone.opening_stock },
    { id: 'pos_ready', title: 'Review POS setup', autoCompleted: completed.has('pos_ready') },
  ].map(step => ({ ...step, completed: completed.has(step.id) || step.autoCompleted }));

  return NextResponse.json({
    success: true,
    settings,
    counts: { users: userCount, locations: locationCount, products: productCount, salesOrders: salesOrderCount, purchaseOrders: purchaseOrderCount, stockRows: stockCount },
    completedSteps: Array.from(completed),
    steps,
    complete: steps.every(s => s.completed),
  });
}

export async function PUT(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const businessId = session.businessId;
  const body = await req.json().catch(() => ({}));
  const settings = body.settings && typeof body.settings === 'object' ? body.settings as Record<string, unknown> : {};

  for (const [key, rawValue] of Object.entries(settings)) {
    await imsExecute(
      'INSERT INTO ims_settings (business_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [businessId, key, rawValue == null ? '' : String(rawValue)],
    );
  }

  if (settings.business_name || settings.business_abn) {
    await BusinessInfoRepository.upsert(businessId, {
      ...(settings.business_name ? { brand_name: String(settings.business_name) } : {}),
      ...(settings.business_abn ? { abn: String(settings.business_abn) } : {}),
    });
  }

  if (body.completeStep || body.reopenStep) {
    const rows = await imsQuery<{ value: string }>('SELECT value FROM ims_settings WHERE business_id = ? AND `key` = ? LIMIT 1', [businessId, PROGRESS_KEY]);
    const completed = new Set(parseCompleted(rows[0]?.value));
    if (body.completeStep) completed.add(String(body.completeStep));
    if (body.reopenStep) completed.delete(String(body.reopenStep));
    await imsExecute(
      'INSERT INTO ims_settings (business_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [businessId, PROGRESS_KEY, JSON.stringify(Array.from(completed))],
    );
  }

  return NextResponse.json({ success: true });
}