import { query } from '@/services/MySQLService';
import { microsToAud } from './money';

export async function reconcileAiBilling() {
  const rows = await query<any>(
    `SELECT a.business_id,a.funding_mode,a.balance_micros,a.cycle_used_micros,a.reserved_micros,
            COALESCE(SUM(CASE WHEN u.status IN ('reserved','submitted','unknown') THEN u.reserved_charge_micros ELSE 0 END),0) expected_reserved_micros,
            SUM(u.status='unknown') unknown_calls,MIN(CASE WHEN u.status='unknown' THEN u.submitted_at END) oldest_unknown_at
       FROM business_ai_accounts a LEFT JOIN ai_usage_calls u ON u.business_id=a.business_id
      GROUP BY a.business_id,a.funding_mode,a.balance_micros,a.cycle_used_micros,a.reserved_micros
      HAVING a.reserved_micros <> expected_reserved_micros OR a.balance_micros < 0 OR unknown_calls > 0`,
  );
  return rows.map(row => ({ businessId: row.business_id, fundingMode: row.funding_mode, reservedAud: microsToAud(BigInt(row.reserved_micros)), expectedReservedAud: microsToAud(BigInt(row.expected_reserved_micros)), unknownCalls: Number(row.unknown_calls), oldestUnknownAt: row.oldest_unknown_at, corrupt: BigInt(row.reserved_micros) !== BigInt(row.expected_reserved_micros) || BigInt(row.balance_micros) < 0n }));
}