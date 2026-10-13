/**
 * GET  /api/user/marketing-settings?databaseId=xxx
 *   Returns current margin tier thresholds from Config tab.
 *
 * POST /api/user/marketing-settings
 *   Body: { databaseId: string, highMin: number, midMin: number }
 *   Writes thresholds to Config tab.
 */
import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/sessionUtils';
import { GoogleSheetsService } from '../../../../services/GoogleSheetsService';
import { ConfigRepository } from '@/lib/db/ConfigRepository';
import { BUDGET_CHANGE_NOTIFICATION_EMAIL } from '@/lib/foresight/budgetChangeNotification';
import { isMarketingScheduledAutomationEnabled, MARKETING_SCHEDULED_AUTOMATION_KEY } from '@/lib/foresight/marketingAutomationSettings';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export const DEFAULT_THRESHOLDS = { high: 65, mid: 40 };
function validEmail(value: string): boolean {
  return value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function requireSession() {
  return getAdminSession();
}

function nc(v: unknown) {
  return String(v ?? '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

async function readConfig(sheets: GoogleSheetsService, databaseId: string, key: string): Promise<string | null> {
  try {
    const cfg = await sheets.getData(databaseId, 'Config!A:B') as string[][] | null;
    return cfg?.find(r => nc(r[0]) === key)?.[1] ?? null;
  } catch { return null; }
}

async function writeConfig(sheets: GoogleSheetsService, databaseId: string, key: string, value: string): Promise<void> {
  await sheets.addSheetIfNotExists(databaseId, 'Config', ['Key', 'Value']);
  const data = await sheets.getData(databaseId, 'Config!A:B') as string[][];
  const rowIndex = data.findIndex(r => nc(r[0]) === key);
  if (rowIndex >= 1) {
    await sheets.updateData(databaseId, `Config!A${rowIndex + 1}`, [[key, value]]);
  } else {
    await sheets.appendData(databaseId, 'Config', [[key, value]]);
  }
}

export async function GET(req: Request) {
  const user = requireSession();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  if (!databaseId || databaseId !== user.businessId) return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });

  try {
    const sheets = new GoogleSheetsService();
    const [rawHigh, rawMid, budgetChangeNotificationEmail, marketingScheduledAutomation] = await Promise.all([
      readConfig(sheets, databaseId, 'MarginTier_High'),
      readConfig(sheets, databaseId, 'MarginTier_Mid'),
      ConfigRepository.get(user.businessId, BUDGET_CHANGE_NOTIFICATION_EMAIL),
      ConfigRepository.get(user.businessId, MARKETING_SCHEDULED_AUTOMATION_KEY),
    ]);
    const high = rawHigh ? parseFloat(rawHigh) : DEFAULT_THRESHOLDS.high;
    const mid  = rawMid  ? parseFloat(rawMid)  : DEFAULT_THRESHOLDS.mid;
    return NextResponse.json({
      success: true,
      thresholds: {
        high: Number.isFinite(high) ? high : DEFAULT_THRESHOLDS.high,
        mid:  Number.isFinite(mid)  ? mid  : DEFAULT_THRESHOLDS.mid,
      },
      defaults: DEFAULT_THRESHOLDS,
      budgetChangeNotificationEmail: budgetChangeNotificationEmail ?? '',
      scheduledMarketingEnabled: isMarketingScheduledAutomationEnabled(marketingScheduledAutomation),
    });
  } catch (e: any) {
    await reportRuntimeIssue({ businessId: user.businessId, source: 'marketing-settings', operation: 'load', title: 'Marketing settings failed to load', error: e });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = requireSession();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'A settings object is required.' }, { status: 400 });
  }
  try {
    const { databaseId, highMin, midMin, budgetChangeNotificationEmail, scheduledMarketingEnabled } = body;
    if (!databaseId || databaseId !== user.businessId) return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
    if (scheduledMarketingEnabled !== undefined && typeof scheduledMarketingEnabled !== 'boolean') {
      return NextResponse.json({ error: 'scheduledMarketingEnabled must be true or false.' }, { status: 400 });
    }

    const high = parseFloat(String(highMin));
    const mid  = parseFloat(String(midMin));

    if (!Number.isFinite(high) || high <= 0 || high > 100)
      return NextResponse.json({ error: 'highMin must be 1–100.' }, { status: 400 });
    if (!Number.isFinite(mid) || mid <= 0 || mid >= high)
      return NextResponse.json({ error: 'midMin must be > 0 and < highMin.' }, { status: 400 });

    const notificationEmail = String(budgetChangeNotificationEmail ?? '').trim().toLowerCase();
    if (!validEmail(notificationEmail)) {
      return NextResponse.json({ error: 'Enter a valid budget change notification email address.' }, { status: 400 });
    }

    const sheets = new GoogleSheetsService();
    await Promise.all([
      writeConfig(sheets, databaseId, 'MarginTier_High', String(high)),
      writeConfig(sheets, databaseId, 'MarginTier_Mid',  String(mid)),
      ConfigRepository.set(user.businessId, BUDGET_CHANGE_NOTIFICATION_EMAIL, notificationEmail),
      ...(scheduledMarketingEnabled === undefined ? [] : [
        ConfigRepository.set(user.businessId, MARKETING_SCHEDULED_AUTOMATION_KEY, String(scheduledMarketingEnabled)),
      ]),
    ]);

    return NextResponse.json({
      success: true,
      thresholds: { high, mid },
      budgetChangeNotificationEmail: notificationEmail,
      ...(scheduledMarketingEnabled === undefined ? {} : { scheduledMarketingEnabled }),
    });
  } catch (e: any) {
    await reportRuntimeIssue({ businessId: user.businessId, source: 'marketing-settings', operation: 'save', title: 'Marketing settings failed to save', error: e });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
