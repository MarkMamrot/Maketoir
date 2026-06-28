import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const pos = cookies().get('pos_session')?.value;
  const adm = cookies().get('marketoir_session')?.value;
  if (pos) try { return JSON.parse(pos); } catch {}
  if (adm) try { return JSON.parse(adm); } catch {}
  return null;
}

// GET /api/pos/leaderboard
// Returns all active locations with today's sales total, open-register status, and avatar.
export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  const locationId = parseInt(String(session.location_id ?? 0), 10);
  if (!locationId) return NextResponse.json({ error: 'No location in session.' }, { status: 400 });

  // Get business_id so we can scope avatar settings to this business
  const locRows = await imsQuery<{ business_id: string | null }>(
    'SELECT business_id FROM ims_locations WHERE id = ? LIMIT 1',
    [locationId],
  );
  const businessId = locRows[0]?.business_id ?? '';

  // Active locations + today's completed sales + open register status
  const locations = await imsQuery<{
    id: number;
    name: string;
    today_sales: number;
    is_open: number;
  }>(`
    SELECT
      l.id,
      l.name,
      COALESCE(s.today_total, 0) AS today_sales,
      CASE WHEN rs.location_id IS NOT NULL THEN 1 ELSE 0 END AS is_open
    FROM ims_locations l
    LEFT JOIN (
      SELECT location_id, SUM(total) AS today_total
      FROM pos_sales
      WHERE DATE(completed_at) = CURDATE()
        AND status = 'completed'
        AND sale_type = 'sale'
      GROUP BY location_id
    ) s ON s.location_id = l.id
    LEFT JOIN (
      SELECT DISTINCT location_id
      FROM pos_register_sessions
      WHERE status = 'open'
    ) rs ON rs.location_id = l.id
    WHERE l.is_active = 1
    ORDER BY today_sales DESC, l.name ASC
  `, []);

  // Batch-fetch all location settings for this business to extract avatars
  const settingsRows = await imsQuery<{ key: string; value: string }>(
    "SELECT `key`, value FROM ims_settings WHERE business_id = ? AND `key` LIKE 'pos_loc_%_settings'",
    [businessId],
  );

  const avatarMap: Record<number, string> = {};
  for (const row of settingsRows) {
    const match = row.key.match(/^pos_loc_(\d+)_settings$/);
    if (match) {
      const id = parseInt(match[1], 10);
      try { const p = JSON.parse(row.value); if (p.avatar) avatarMap[id] = p.avatar; } catch {}
    }
  }

  return NextResponse.json({
    locations: locations.map(loc => ({
      id:          loc.id,
      name:        loc.name,
      today_sales: Number(loc.today_sales),
      is_open:     Number(loc.is_open) === 1,
      avatar:      avatarMap[loc.id] ?? '',
    })),
  });
}
