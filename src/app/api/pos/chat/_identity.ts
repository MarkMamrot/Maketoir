import { getImsSession } from '@/lib/auth/imsSession';
import { imsQuery } from '@/services/IMSMySQLService';

export type ChatIdentity = {
  businessId: string;
  locationId: number;
  locationName: string;
  userName: string;
  avatar: string;
  source: 'pos' | 'ims';
};

export async function resolveChatIdentity(surface: 'auto' | 'ims' = 'auto'): Promise<ChatIdentity | null> {
  const session = await getImsSession(surface === 'ims' ? ['marketoir_session'] : ['pos_session', 'marketoir_session']);
  if (!session?.businessId) return null;

  const rawSession = session as typeof session & {
    location_id?: number;
    location_name?: string;
    full_name?: string;
    username?: string;
    avatar?: string;
  };
  const sessionLocationId = surface === 'ims' ? 0 : Number(rawSession.location_id ?? 0);

  const locations = sessionLocationId > 0
    ? await imsQuery<{ id: number; name: string }>(
        'SELECT id, name FROM ims_locations WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1',
        [sessionLocationId, session.businessId],
      )
    : await imsQuery<{ id: number; name: string }>(
        `SELECT l.id, l.name
         FROM ims_settings s
         JOIN ims_locations l
           ON l.id = CAST(s.value AS UNSIGNED)
          AND l.business_id = s.business_id
          AND l.is_active = 1
         WHERE s.business_id = ? AND s.key = 'default_warehouse_location_id'
         LIMIT 1`,
        [session.businessId],
      );
  const location = locations[0];
  if (!location) return null;

  let avatar = rawSession.avatar ?? '';
  if (!avatar) {
    const settings = await imsQuery<{ value: string }>(
      'SELECT value FROM ims_settings WHERE business_id = ? AND `key` = ? LIMIT 1',
      [session.businessId, `pos_loc_${location.id}_settings`],
    );
    try { avatar = String(JSON.parse(settings[0]?.value ?? '{}').avatar ?? ''); } catch {}
  }

  return {
    businessId: session.businessId,
    locationId: Number(location.id),
    locationName: location.name,
    userName: String(rawSession.full_name ?? session.name ?? rawSession.username ?? session.email ?? 'Staff'),
    avatar: avatar.replace(/[^a-zA-Z0-9_.\-]/g, '').slice(0, 100),
    source: sessionLocationId > 0 ? 'pos' : 'ims',
  };
}