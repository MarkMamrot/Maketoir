import { execute } from '@/services/MySQLService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export type AuthEventType = 'login_success' | 'login_failure' | 'login_lockout' | 'password_renewal_required'
  | 'mfa_failure' | 'mfa_enrolled' | 'mfa_recovery_used' | 'mfa_trust_used'
  | 'password_reset_requested' | 'password_reset_completed';

export interface AuthRequestMetadata {
  ipAddress: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  userAgent: string | null;
}

function cleanHeader(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/[\u0000-\u001f\u007f]/g, '');
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function decodeLocationHeader(value: string | null, maxLength: number): string | null {
  const cleaned = cleanHeader(value, maxLength * 3);
  if (!cleaned) return null;
  try {
    return cleanHeader(decodeURIComponent(cleaned), maxLength);
  } catch {
    return cleaned.slice(0, maxLength);
  }
}

export function getAuthRequestMetadata(req: Request): AuthRequestMetadata {
  const forwardedIp = req.headers.get('x-forwarded-for')?.split(',')[0] ?? null;
  return {
    ipAddress: cleanHeader(forwardedIp || req.headers.get('x-real-ip'), 45),
    city: decodeLocationHeader(req.headers.get('x-vercel-ip-city'), 100),
    region: decodeLocationHeader(req.headers.get('x-vercel-ip-country-region'), 100),
    country: cleanHeader(req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry'), 2)?.toUpperCase() ?? null,
    userAgent: cleanHeader(req.headers.get('user-agent'), 500),
  };
}

export async function recordAuthEvent(input: {
  userId?: number | null;
  businessId?: string | null;
  eventType: AuthEventType;
  actorUserId?: number | null;
  request: Request;
}): Promise<void> {
  const metadata = getAuthRequestMetadata(input.request);
  let inserted = false;
  try {
    await execute(
      `INSERT INTO user_auth_events
        (business_id, user_id, event_type, actor_user_id, ip_address, city, region, country, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.businessId ?? null,
        input.userId ?? null,
        input.eventType,
        input.actorUserId ?? null,
        metadata.ipAddress,
        metadata.city,
        metadata.region,
        metadata.country,
        metadata.userAgent,
      ],
    );
    inserted = true;
    await execute('DELETE FROM user_auth_events WHERE created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 12 MONTH)');
  } catch (error) {
    await reportRuntimeIssue({
      businessId: input.businessId ?? null,
      source: 'auth.activity',
      operation: inserted ? 'purge_expired_auth_events' : 'record_auth_event',
      title: inserted ? 'Expired authentication activity could not be removed' : 'Authentication activity could not be recorded',
      error,
      context: { userId: input.userId, eventType: input.eventType },
      reference: input.userId ? { type: 'user', id: input.userId } : undefined,
    });
  }
}