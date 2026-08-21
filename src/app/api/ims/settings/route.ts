import { NextResponse } from 'next/server';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { DEFAULT_BUSINESS_TIME_ZONE, isValidBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { DEFAULT_LOYALTY_SETTINGS, LOYALTY_SETTING_KEYS } from '@/lib/loyalty/types';
import {
  DEFAULT_URL_JUDGE_MODEL,
  DEFAULT_WEBSITE_CONTENT_MODEL,
  isValidGeminiModelId,
  WEBSITE_AI_SETTING_KEYS,
} from '@/lib/website/contentPreferences';
import { SALES_DOCUMENT_SETTING_KEYS, validateSalesDocumentSetting } from '@/lib/ims/salesDocumentSettings';
import { SELLS_WHOLESALE_SETTING_KEY } from '@/lib/wholesale/wholesaleAccess';
import { WholesaleSupplierProfileRepository } from '@/lib/wholesale/wholesaleSupplierProfile';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import {
  applyWholesalePortalSettingDefaults,
  validateWholesalePortalSetting,
} from '@/lib/wholesale/wholesalePortalSettings';

// Settings whose changes affect the inventory qty pushed to Shopify.
// When any of these keys change we must re-enqueue every linked variant so the
// next cron run re-syncs them with the new buffer / new pick-location set.
const INVENTORY_SENSITIVE_KEYS = new Set([
  'shopify_inventory_buffer',
  'online_pick_priority',
]);

/** GET /api/ims/settings — returns all settings for the business as { key: value } */
export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId;
  try {
    const rows = await imsQuery<{ key: string; value: string }>(
      'SELECT `key`, `value` FROM ims_settings WHERE business_id = ?',
      [businessId]
    );
    const settings: Record<string, string> = {};
    for (const row of rows) settings[row.key] = row.value ?? '';
    settings.business_timezone ||= DEFAULT_BUSINESS_TIME_ZONE;
    settings[LOYALTY_SETTING_KEYS.enabled] ??= DEFAULT_LOYALTY_SETTINGS.enabled ? '1' : '0';
    settings[LOYALTY_SETTING_KEYS.earnRate] ??= String(DEFAULT_LOYALTY_SETTINGS.earnRate);
    settings[LOYALTY_SETTING_KEYS.programName] ??= DEFAULT_LOYALTY_SETTINGS.programName;
    settings[LOYALTY_SETTING_KEYS.pointsLabel] ??= DEFAULT_LOYALTY_SETTINGS.pointsLabel;
    settings[LOYALTY_SETTING_KEYS.startedAt] ??= '';
    settings[WEBSITE_AI_SETTING_KEYS.contentModel] ||= DEFAULT_WEBSITE_CONTENT_MODEL;
    settings[WEBSITE_AI_SETTING_KEYS.urlJudgeModel] ||= DEFAULT_URL_JUDGE_MODEL;
    settings[WEBSITE_AI_SETTING_KEYS.measurementSystem] ||= 'auto';
    settings[SALES_DOCUMENT_SETTING_KEYS.showLogo] ??= '1';
    settings[SELLS_WHOLESALE_SETTING_KEY] ??= 'yes';
    applyWholesalePortalSettingDefaults(settings);
    // Include Shopify shop domain so client can build admin links without a separate fetch
    const conn = await ConnectionsRepository.get(businessId);
    const shopDomain: string = conn?.shopify_shop_id ?? '';
    return NextResponse.json({ success: true, data: settings, shopDomain });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

/**
 * PUT /api/ims/settings — upserts one or more key/value pairs.
 * Body: { key: string, value: string } or { settings: Record<string, string> }
 */
export async function PUT(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId;
  try {
    const body = await req.json();
    // Accept either { key, value } or { settings: { key: value, ... } }
    const pairs: Record<string, string> =
      body.settings ?? (body.key !== undefined ? { [body.key]: body.value } : body);

    for (const [key, rawValue] of Object.entries(pairs)) {
      const result = validateSalesDocumentSetting(key, rawValue);
      if (!result) continue;
      if ('error' in result) {
        return NextResponse.json({ success: false, error: result.error }, { status: 400 });
      }
      pairs[key] = result.value;
    }

    if (pairs.business_timezone !== undefined && !isValidBusinessTimeZone(String(pairs.business_timezone))) {
      return NextResponse.json({ success: false, error: 'Invalid business timezone.' }, { status: 400 });
    }
    if (pairs[SELLS_WHOLESALE_SETTING_KEY] !== undefined && !['yes', 'no'].includes(String(pairs[SELLS_WHOLESALE_SETTING_KEY]))) {
      return NextResponse.json({ success: false, error: 'Sells wholesale must be yes or no.' }, { status: 400 });
    }
    for (const [key, rawValue] of Object.entries(pairs)) {
      const normalized = validateWholesalePortalSetting(key, rawValue);
      if (normalized === null) continue;
      if (!normalized) {
        return NextResponse.json({ success: false, error: `Invalid wholesale portal setting: ${key}.` }, { status: 400 });
      }
      pairs[key] = normalized;
    }
    if (pairs.pending_online_invalid_url_exclusion_days !== undefined) {
      const days = Number(pairs.pending_online_invalid_url_exclusion_days);
      if (!Number.isInteger(days) || days < 0 || days > 90) {
        return NextResponse.json({ success: false, error: 'Pending Online exclusion days must be an integer from 0 to 90.' }, { status: 400 });
      }
      pairs.pending_online_invalid_url_exclusion_days = String(days);
    }
    for (const key of [WEBSITE_AI_SETTING_KEYS.contentModel, WEBSITE_AI_SETTING_KEYS.urlJudgeModel]) {
      if (pairs[key] === undefined) continue;
      const modelId = String(pairs[key]).trim();
      if (!isValidGeminiModelId(modelId)) {
        return NextResponse.json({ success: false, error: 'AI model must be a valid Gemini text model.' }, { status: 400 });
      }
      pairs[key] = modelId;
    }
    if (pairs[WEBSITE_AI_SETTING_KEYS.measurementSystem] !== undefined) {
      const measurementSystem = String(pairs[WEBSITE_AI_SETTING_KEYS.measurementSystem]);
      if (!['auto', 'metric', 'imperial'].includes(measurementSystem)) {
        return NextResponse.json({ success: false, error: 'Measurement system must be automatic, metric, or imperial.' }, { status: 400 });
      }
    }
    if (pairs[LOYALTY_SETTING_KEYS.enabled] !== undefined && !['0', '1'].includes(String(pairs[LOYALTY_SETTING_KEYS.enabled]))) {
      return NextResponse.json({ success: false, error: 'Loyalty enabled must be 0 or 1.' }, { status: 400 });
    }
    if (pairs[LOYALTY_SETTING_KEYS.earnRate] !== undefined) {
      const earnRate = Number(pairs[LOYALTY_SETTING_KEYS.earnRate]);
      if (!Number.isFinite(earnRate) || earnRate <= 0 || earnRate > 100) {
        return NextResponse.json({ success: false, error: 'Loyalty earn rate must be greater than 0 and no more than 100.' }, { status: 400 });
      }
      pairs[LOYALTY_SETTING_KEYS.earnRate] = String(earnRate);
    }
    for (const [key, label, maxLength] of [
      [LOYALTY_SETTING_KEYS.programName, 'Loyalty program name', 100],
      [LOYALTY_SETTING_KEYS.pointsLabel, 'Loyalty points label', 30],
    ] as const) {
      if (pairs[key] === undefined) continue;
      const value = String(pairs[key]).trim();
      if (!value || value.length > maxLength) {
        return NextResponse.json({ success: false, error: `${label} is required and must be ${maxLength} characters or fewer.` }, { status: 400 });
      }
      pairs[key] = value;
    }
    if (pairs[LOYALTY_SETTING_KEYS.startedAt] !== undefined) {
      const startedAt = String(pairs[LOYALTY_SETTING_KEYS.startedAt]).trim();
      const parsedDate = startedAt ? new Date(`${startedAt}T00:00:00.000Z`) : null;
      if (startedAt && (!/^\d{4}-\d{2}-\d{2}$/.test(startedAt) || !parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== startedAt)) {
        return NextResponse.json({ success: false, error: 'Loyalty start date must be a valid date.' }, { status: 400 });
      }
      pairs[LOYALTY_SETTING_KEYS.startedAt] = startedAt;
    }

    for (const [key, value] of Object.entries(pairs)) {
      await imsExecute(
        'INSERT INTO ims_settings (business_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [businessId, key, value ?? null]
      );
    }

    if (pairs[SELLS_WHOLESALE_SETTING_KEY] === 'yes') {
      await WholesaleSupplierProfileRepository.ensureForBusiness(businessId);
    } else if (pairs[SELLS_WHOLESALE_SETTING_KEY] === 'no') {
      await WholesaleSupplierProfileRepository.deactivate(businessId);
    }

    // If any inventory-sync setting changed, re-enqueue all Shopify-linked variants
    // so the next cron run applies the new buffer / pick-locations immediately.
    const inventoryAffected = Object.keys(pairs).some(k => INVENTORY_SENSITIVE_KEYS.has(k));
    if (inventoryAffected) {
      await imsExecute(
        `INSERT IGNORE INTO ims_shopify_inventory_queue (variant_id, queued_at)
         SELECT v.variant_id, NOW()
           FROM ims_product_variants v
           JOIN ims_products p ON p.product_id = v.product_id
          WHERE p.business_id = ?
            AND v.shopify_inventory_item_id IS NOT NULL
            AND v.shopify_inventory_item_id <> ''`,
        [businessId],
      );
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims.settings',
      operation: 'save_settings',
      title: 'IMS settings could not be saved',
      error: e,
    });
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
