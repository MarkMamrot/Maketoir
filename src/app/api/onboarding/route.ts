import { NextResponse } from 'next/server';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { BusinessInfoRepository } from '@/lib/db/BusinessInfoRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

const PROGRESS_KEY = 'onboarding_completed_steps';
const ONBOARDING_STEP_IDS = [
  'business_profile',
  'operations',
  'tax',
  'integrations',
  'users',
  'locations',
  'products',
  'sales_orders',
  'purchase_orders',
  'opening_stock',
  'pos_ready',
] as const;
const ONBOARDING_STEP_ID_SET = new Set<string>(ONBOARDING_STEP_IDS);
const ONBOARDING_SETTING_KEYS = new Set([
  'business_name',
  'business_address',
  'business_address_line1',
  'business_address_line2',
  'business_suburb',
  'business_state',
  'business_postcode',
  'business_country',
  'business_phone',
  'business_abn',
  'use_multiple_locations',
  'use_zones_bins',
  'use_categories',
  'use_foreign_currencies',
  'connect_online_shop',
  'online_shop_platform',
  'connect_accounting_software',
  'accounting_software',
  'sales_tax_on_sales',
  'sales_tax_rate',
  'sales_tax_code',
  'purchase_tax_rate',
  'purchase_tax_code',
]);

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
  const rows = await query<{ c: number }>(sql, params);
  return Number(rows[0]?.c ?? 0);
}

async function countIms(sql: string, params: unknown[] = []) {
  const rows = await imsQuery<{ c: number }>(sql, params);
  return Number(rows[0]?.c ?? 0);
}

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const businessId = session.businessId;
  try {
    const [settingsRows, businessInfo, counts] = await Promise.all([
      imsQuery<{ key: string; value: string }>('SELECT `key`, value FROM ims_settings WHERE business_id = ?', [businessId]),
      BusinessInfoRepository.get(businessId),
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

    const completed = normalizeCompleted(settings[PROGRESS_KEY]);
    const [userCount, locationCount, productCount, salesOrderCount, purchaseOrderCount, stockCount] = counts;

    const steps = [
    { id: 'business_profile', title: 'Business identity' },
    { id: 'operations', title: 'Operations' },
    { id: 'tax', title: 'Tax settings' },
    { id: 'integrations', title: 'Integrations' },
    { id: 'users', title: 'Add additional users' },
    { id: 'locations', title: 'Add locations' },
    { id: 'products', title: 'Import products' },
    { id: 'sales_orders', title: 'Import sales orders' },
    { id: 'purchase_orders', title: 'Import purchase orders' },
    { id: 'opening_stock', title: 'Set opening stock' },
    { id: 'pos_ready', title: 'Review POS setup' },
    ].map(step => ({ ...step, autoCompleted: false, completed: completed.has(step.id) }));

    return NextResponse.json({
      success: true,
      settings,
      counts: { users: userCount, locations: locationCount, products: productCount, salesOrders: salesOrderCount, purchaseOrders: purchaseOrderCount, stockRows: stockCount },
      completedSteps: Array.from(completed),
      steps,
      complete: steps.every(s => s.completed),
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'onboarding',
      operation: 'load_progress',
      title: 'Business onboarding progress failed to load',
      error,
    });
    return NextResponse.json({ success: false, error: 'Onboarding progress could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const businessId = session.businessId;
  const body = await req.json().catch(() => ({}));
  const completeStep = body.completeStep == null ? null : String(body.completeStep);
  const reopenStep = body.reopenStep == null ? null : String(body.reopenStep);

  if ((completeStep && !ONBOARDING_STEP_ID_SET.has(completeStep)) || (reopenStep && !ONBOARDING_STEP_ID_SET.has(reopenStep))) {
    return NextResponse.json({ error: 'Invalid onboarding step' }, { status: 400 });
  }

  const settings = body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)
    ? Object.entries(body.settings as Record<string, unknown>)
      .filter(([key]) => ONBOARDING_SETTING_KEYS.has(key))
      .map(([key, value]) => [key, value == null ? '' : String(value)] as const)
    : [];
  const settingsMap = Object.fromEntries(settings);
  const structuredAddressKeys = [
    'business_address_line1', 'business_address_line2', 'business_suburb',
    'business_state', 'business_postcode', 'business_country',
  ];
  if (structuredAddressKeys.some(key => settingsMap[key] !== undefined)) {
    settingsMap.business_address = formatBusinessAddress(settingsMap);
  }
  for (const [key, value] of Object.entries(settingsMap)) {
    await imsExecute(
      'INSERT INTO ims_settings (business_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [businessId, key, value],
    );
  }

  const businessInfo = settingsMap;
  if (businessInfo.business_name !== undefined || businessInfo.business_abn !== undefined) {
    await BusinessInfoRepository.upsert(businessId, {
      ...(businessInfo.business_name !== undefined ? { brand_name: businessInfo.business_name } : {}),
      ...(businessInfo.business_abn !== undefined ? { abn: businessInfo.business_abn } : {}),
    });
  }

  if (completeStep || reopenStep) {
    const rows = await imsQuery<{ value: string }>('SELECT value FROM ims_settings WHERE business_id = ? AND `key` = ? LIMIT 1', [businessId, PROGRESS_KEY]);
    const completed = normalizeCompleted(rows[0]?.value);
    if (completeStep) completed.add(completeStep);
    if (reopenStep) completed.delete(reopenStep);
    await imsExecute(
      'INSERT INTO ims_settings (business_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [businessId, PROGRESS_KEY, JSON.stringify(Array.from(completed))],
    );
  }

  return NextResponse.json({ success: true });
}

function normalizeCompleted(raw: string | undefined): Set<string> {
  const completed = new Set(parseCompleted(raw));
  if (completed.has('operations_tax')) {
    completed.add('operations');
    completed.add('tax');
  }
  if (completed.has('online_shop') && completed.has('accounting')) completed.add('integrations');
  return new Set([...completed].filter(step => ONBOARDING_STEP_ID_SET.has(step)));
}

function formatBusinessAddress(settings: Record<string, string>): string {
  const locality = [settings.business_suburb, settings.business_state, settings.business_postcode]
    .map(value => value?.trim())
    .filter(Boolean)
    .join(' ');
  return [settings.business_address_line1, settings.business_address_line2, locality, settings.business_country]
    .map(value => value?.trim())
    .filter(Boolean)
    .join(', ');
}