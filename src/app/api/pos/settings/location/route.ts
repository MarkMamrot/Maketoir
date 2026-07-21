import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function getAdminSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const TIER_RANK: Record<string, number> = {
  SuperAdmin: 5, Admin: 4, StandardUser: 3, PosManager: 2, PosUser: 1,
};
function canEdit(tier: string | undefined): boolean {
  return (TIER_RANK[tier ?? 'PosUser'] ?? 1) >= TIER_RANK['PosManager'];
}

export interface PosLocationSettings {
  receiptFooter:      string;
  giftReceiptMessage: string;
  theme:              string; // preset key
  topbarColor:        string; // hex or ''
  searchbarColor:     string; // hex or ''
  avatar:             string; // filename from /avatars/
  bgImage:            string; // base64 data URL or ''
  bgOpacity:          number; // 0-30
  bgPosition:         'center' | 'bottom';
  bgScale:            'fit' | 'original';
}

const DEFAULTS: PosLocationSettings = {
  receiptFooter: '',
  giftReceiptMessage: '',
  theme: 'midnight',
  topbarColor: '',
  searchbarColor: '',
  avatar: '',
  bgImage: '',
  bgOpacity: 10,
  bgPosition: 'center',
  bgScale: 'fit',
};

const SETTINGS_KEY = (locationId: number) => `pos_loc_${locationId}_settings`;

// GET /api/pos/settings/location?location_id=X
export async function GET(req: Request) {
  const posSession   = getPosSession();
  const adminSession = getAdminSession();
  if (!posSession && !adminSession) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }
  const boundSession = await getImsSession(['pos_session', 'marketoir_session']);

  const { searchParams } = new URL(req.url);
  const rawId = searchParams.get('location_id') ?? String(posSession?.location_id ?? 0);
  const locationId = parseInt(rawId, 10);
  if (!locationId || isNaN(locationId)) {
    return NextResponse.json({ error: 'location_id required.' }, { status: 400 });
  }

  // Resolve business_id so we scope reads to the right business
  const locRows = await imsQuery<{ business_id: string | null }>(
    'SELECT business_id FROM ims_locations WHERE id = ? AND business_id = ? LIMIT 1',
    [locationId, boundSession?.businessId ?? ''],
  );
  const businessId = locRows[0]?.business_id ?? '';

  const rows = await imsQuery<{ value: string }>(
    'SELECT `value` FROM ims_settings WHERE business_id = ? AND `key` = ? LIMIT 1',
    [businessId, SETTINGS_KEY(locationId)],
  );

  let settings: PosLocationSettings = { ...DEFAULTS };
  if (rows[0]?.value) {
    try { settings = { ...DEFAULTS, ...JSON.parse(rows[0].value) }; } catch {}
  }

  return NextResponse.json({ success: true, settings });
}

// PUT /api/pos/settings/location
// Body: { location_id, ...PosLocationSettings }
export async function PUT(req: Request) {
  const posSession   = getPosSession();
  const adminSession = getAdminSession();
  const boundSession = await getImsSession(['pos_session', 'marketoir_session']);

  // Only POS Manager+ or admin can write
  const tier = posSession?.tier ?? posSession?.role ?? null;
  if (!adminSession && !canEdit(tier)) {
    return NextResponse.json({ error: 'POS Manager or above required.' }, { status: 403 });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  const locationId = parseInt(String(body.location_id ?? posSession?.location_id ?? 0), 10);
  if (!locationId || isNaN(locationId)) {
    return NextResponse.json({ error: 'location_id required.' }, { status: 400 });
  }

  const locRows = await imsQuery<{ business_id: string | null }>(
    'SELECT business_id FROM ims_locations WHERE id = ? AND business_id = ? LIMIT 1',
    [locationId, boundSession?.businessId ?? ''],
  );
  const businessId = locRows[0]?.business_id ?? '';

  const settings: PosLocationSettings = {
    receiptFooter:      String(body.receiptFooter ?? '').slice(0, 500),
    giftReceiptMessage: String(body.giftReceiptMessage ?? '').slice(0, 500),
    theme:              String(body.theme ?? 'classic').slice(0, 30),
    topbarColor:        String(body.topbarColor ?? '').slice(0, 30),
    searchbarColor:     String(body.searchbarColor ?? '').slice(0, 30),
    avatar:             String(body.avatar ?? '').replace(/[^a-zA-Z0-9_.\-]/g, '').slice(0, 100),    bgImage:            String(body.bgImage ?? '').slice(0, 5_000_000), // base64 JPEG, capped at ~5 MB
    bgOpacity:          Math.min(30, Math.max(0, Number(body.bgOpacity ?? 10))),
    bgPosition:         body.bgPosition === 'bottom' ? 'bottom' : 'center',
    bgScale:            body.bgScale === 'original' ? 'original' : 'fit',  };

  await imsExecute(
    `INSERT INTO ims_settings (business_id, \`key\`, value, updated_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()`,
    [businessId, SETTINGS_KEY(locationId), JSON.stringify(settings)],
  );

  return NextResponse.json({ success: true, settings });
}
