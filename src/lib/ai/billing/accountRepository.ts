import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { getPool, query } from '@/services/MySQLService';
import { audToMicros, microsToAud } from './money';
import { AI_CYCLE_MODES, AI_ENFORCEMENT_MODES, AI_FUNDING_MODES, AI_PLAN_KEYS } from './types';

function aud(value: unknown): string { return microsToAud(BigInt(String(value ?? 0))); }

async function transact<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getPool().getConnection();
  try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result; }
  catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export const AiAccountRepository = {
  async tenantDetail(businessId: string) {
    const [accounts, usageByArea, recentCalls, ledger] = await Promise.all([
      query<any>(`SELECT a.*, p.display_name AS plan_name FROM business_ai_accounts a JOIN ai_plans p ON p.plan_key = a.plan_key WHERE a.business_id = ?`, [businessId]),
      query<any>(`SELECT area, COUNT(*) calls, SUM(tenant_charge_micros) charge_micros FROM ai_usage_calls WHERE business_id = ? AND created_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY GROUP BY area ORDER BY charge_micros DESC`, [businessId]),
      query<any>(`SELECT id, area, operation, model_id, status, input_tokens, output_tokens, output_images, video_seconds, tenant_charge_micros, created_at FROM ai_usage_calls WHERE business_id = ? ORDER BY id DESC LIMIT 50`, [businessId]),
      query<any>(`SELECT entry_type, amount_micros, reason, notes, external_reference, balance_after_micros, cycle_used_after_micros, created_at FROM ai_account_ledger WHERE business_id = ? ORDER BY id DESC LIMIT 50`, [businessId]),
    ]);
    const account = accounts[0];
    if (!account) return null;
    return {
      account: {
        businessId, planKey: account.plan_key, planName: account.plan_name, fundingMode: account.funding_mode,
        enforcementMode: account.enforcement_mode, cycleMode: account.cycle_mode, cycleAnchorDay: account.cycle_anchor_day,
        cycleTimezone: account.cycle_timezone, cycleStart: account.cycle_started_at, cycleEnd: account.cycle_ends_at,
        balanceAud: aud(account.balance_micros), limitAud: aud(account.cycle_limit_micros), usedAud: aud(account.cycle_used_micros),
        reservedAud: aud(account.reserved_micros), remainingAud: aud(account.funding_mode === 'prepaid'
          ? BigInt(account.balance_micros) - BigInt(account.reserved_micros)
          : BigInt(account.cycle_limit_micros) - BigInt(account.cycle_used_micros) - BigInt(account.reserved_micros)),
        warningPercent: account.warning_percent,
      },
      usageByArea: usageByArea.map(row => ({ area: row.area, calls: Number(row.calls), chargeAud: aud(row.charge_micros) })),
      recentCalls: recentCalls.map(row => ({ ...row, chargeAud: aud(row.tenant_charge_micros), tenant_charge_micros: undefined })),
      ledger: ledger.map(row => ({ ...row, amountAud: aud(row.amount_micros), balanceAfterAud: aud(row.balance_after_micros), cycleUsedAfterAud: aud(row.cycle_used_after_micros), amount_micros: undefined, balance_after_micros: undefined, cycle_used_after_micros: undefined })),
    };
  },

  async adminSummary(from?: string, to?: string) {
    const dateSql = `${from ? ' AND u.created_at >= ?' : ''}${to ? ' AND u.created_at < DATE_ADD(?, INTERVAL 1 DAY)' : ''}`;
    const params = [from, to].filter(Boolean);
    const rows = await query<any>(
      `SELECT a.business_id, COALESCE(b.name, 'Solvantis Platform') business_name, a.plan_key, a.funding_mode, a.enforcement_mode,
              a.balance_micros, a.cycle_limit_micros, a.cycle_used_micros, a.reserved_micros,
              COUNT(u.id) calls, COALESCE(SUM(u.provider_cost_micros),0) provider_cost_micros,
              COALESCE(SUM(u.tenant_charge_micros),0) tenant_charge_micros,
              SUM(u.status = 'unknown') unknown_calls, MAX(u.created_at) last_used_at
         FROM business_ai_accounts a LEFT JOIN businesses b ON b.business_id = a.business_id
         LEFT JOIN ai_usage_calls u ON u.business_id = a.business_id${dateSql}
        GROUP BY a.business_id, b.name, a.plan_key, a.funding_mode, a.enforcement_mode, a.balance_micros, a.cycle_limit_micros, a.cycle_used_micros, a.reserved_micros
        ORDER BY business_name`, params);
    return rows.map(row => ({
      businessId: row.business_id, businessName: row.business_name, planKey: row.plan_key, fundingMode: row.funding_mode,
      enforcementMode: row.enforcement_mode, balanceAud: aud(row.balance_micros), limitAud: aud(row.cycle_limit_micros),
      usedAud: aud(row.cycle_used_micros), reservedAud: aud(row.reserved_micros), calls: Number(row.calls),
      providerCostAud: aud(row.provider_cost_micros), tenantChargeAud: aud(row.tenant_charge_micros),
      marginAud: aud(BigInt(row.tenant_charge_micros) - BigInt(row.provider_cost_micros)), unknownCalls: Number(row.unknown_calls), lastUsedAt: row.last_used_at,
    }));
  },

  async configure(businessId: string, input: any, actorUserId: number, actorName: string) {
    if (!AI_PLAN_KEYS.includes(input.planKey)) throw new Error('Invalid AI plan.');
    if (!AI_FUNDING_MODES.includes(input.fundingMode)) throw new Error('Invalid funding mode.');
    if (!AI_ENFORCEMENT_MODES.includes(input.enforcementMode)) throw new Error('Invalid enforcement mode.');
    if (!AI_CYCLE_MODES.includes(input.cycleMode)) throw new Error('Invalid cycle mode.');
    const limit = audToMicros(input.limitAud ?? '0');
    if (limit < 0n) throw new Error('Account limit cannot be negative.');
    return transact(async connection => {
      const [rows] = await connection.execute<any[]>(`SELECT * FROM business_ai_accounts WHERE business_id = ? FOR UPDATE`, [businessId]);
      if (!rows[0]) throw new Error('AI account not found.');
      await connection.execute(
        `UPDATE business_ai_accounts SET plan_key=?, funding_mode=?, enforcement_mode=?, cycle_mode=?, cycle_anchor_day=?, cycle_timezone=?, cycle_limit_micros=?, warning_percent=?, version=version+1 WHERE business_id=?`,
        [input.planKey, input.fundingMode, input.enforcementMode, input.cycleMode, Math.min(31, Math.max(1, Number(input.cycleAnchorDay ?? 1))), String(input.cycleTimezone || 'Australia/Sydney'), limit.toString(), Math.min(100, Math.max(1, Number(input.warningPercent ?? 80))), businessId],
      );
      await connection.execute(
        `INSERT INTO ai_account_ledger (business_id,idempotency_key,entry_type,balance_after_micros,cycle_used_after_micros,reason,notes,actor_user_id,actor_name) VALUES (?,?, 'account_change',?,?, 'admin_configuration',?,?,?)`,
        [businessId, input.idempotencyKey || randomUUID(), rows[0].balance_micros, rows[0].cycle_used_micros, String(input.reason || '').slice(0, 500), actorUserId, actorName],
      );
      return true;
    });
  },

  async adjustCredit(businessId: string, input: any, actorUserId: number, actorName: string) {
    const amount = audToMicros(input.amountAud);
    if (amount === 0n || !String(input.reason || '').trim() || !String(input.idempotencyKey || '').trim()) throw new Error('A non-zero amount, reason, and idempotency key are required.');
    return transact(async connection => {
      const [rows] = await connection.execute<any[]>(`SELECT * FROM business_ai_accounts WHERE business_id = ? FOR UPDATE`, [businessId]);
      const account = rows[0];
      if (!account) throw new Error('AI account not found.');
      const balance = BigInt(account.balance_micros) + amount;
      if (balance < 0n) throw new Error('Credit removal exceeds the available balance.');
      await connection.execute(`UPDATE business_ai_accounts SET balance_micros=?, version=version+1 WHERE business_id=?`, [balance.toString(), businessId]);
      await connection.execute(
        `INSERT INTO ai_account_ledger (business_id,idempotency_key,entry_type,amount_micros,balance_after_micros,cycle_used_after_micros,reason,notes,external_reference,actor_user_id,actor_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [businessId, input.idempotencyKey, amount > 0n ? 'credit_grant' : 'credit_removal', amount.toString(), balance.toString(), account.cycle_used_micros, String(input.reason).slice(0, 100), String(input.notes || '').slice(0, 500) || null, String(input.externalReference || '').slice(0, 191) || null, actorUserId, actorName],
      );
      return { balanceAud: aud(balance) };
    });
  },

  async resetCycle(businessId: string, reason: string, actorUserId: number, actorName: string) {
    if (!reason.trim()) throw new Error('A reset reason is required.');
    return transact(async connection => {
      const [rows] = await connection.execute<any[]>(`SELECT * FROM business_ai_accounts WHERE business_id = ? FOR UPDATE`, [businessId]);
      if (!rows[0]) throw new Error('AI account not found.');
      await connection.execute(`UPDATE business_ai_accounts SET cycle_used_micros=0, cycle_started_at=NOW(3), cycle_ends_at=NULL, version=version+1 WHERE business_id=?`, [businessId]);
      await connection.execute(`INSERT INTO ai_account_ledger (business_id,idempotency_key,entry_type,balance_after_micros,cycle_used_after_micros,reason,actor_user_id,actor_name) VALUES (?,?, 'cycle_reset',?,0,?,?,?)`, [businessId, randomUUID(), rows[0].balance_micros, reason.slice(0, 100), actorUserId, actorName]);
      return true;
    });
  },

  async releaseUnknown(businessId: string, callId: number, reason: string, actorUserId: number, actorName: string) {
    if (!Number.isInteger(callId) || callId <= 0 || !reason.trim()) throw new Error('A valid call and reason are required.');
    return transact(async connection => {
      const [calls] = await connection.execute<any[]>(`SELECT id,reserved_charge_micros,status FROM ai_usage_calls WHERE id=? AND business_id=? FOR UPDATE`, [callId, businessId]);
      const call = calls[0];
      if (!call || !['submitted','unknown'].includes(call.status)) throw new Error('The call is not an unresolved reservation for this business.');
      const [accounts] = await connection.execute<any[]>(`SELECT balance_micros,cycle_used_micros FROM business_ai_accounts WHERE business_id=? FOR UPDATE`, [businessId]);
      if (!accounts[0]) throw new Error('AI account not found.');
      await connection.execute(`UPDATE business_ai_accounts SET reserved_micros=GREATEST(0,reserved_micros-?),version=version+1 WHERE business_id=?`, [call.reserved_charge_micros, businessId]);
      await connection.execute(`UPDATE ai_usage_calls SET status='released',safe_error=?,settled_at=NOW(3) WHERE id=?`, [`Admin release: ${reason}`.slice(0,500), callId]);
      await connection.execute(`INSERT INTO ai_account_ledger (business_id,idempotency_key,entry_type,balance_after_micros,cycle_used_after_micros,usage_call_id,reason,actor_user_id,actor_name) VALUES (?,?, 'reservation_release',?,?,?,?,?,?)`, [businessId, `release:${callId}`, accounts[0].balance_micros, accounts[0].cycle_used_micros, callId, reason.slice(0,100), actorUserId, actorName]);
      return true;
    });
  },
};