import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getPool, query } from '@/services/MySQLService';
import { calculateCycle } from './cycles';
import type { AiBillingContext, AiRateMetric, AiUsageUnits } from './types';

type AccountRow = RowDataPacket & {
  business_id: string; plan_key: string; funding_mode: 'prepaid' | 'account_limit';
  enforcement_mode: 'observe' | 'enforce' | 'suspended'; cycle_mode: 'billing_anniversary' | 'calendar_month' | 'manual';
  cycle_anchor_day: number; cycle_timezone: string; cycle_started_at: Date | null; cycle_ends_at: Date | null;
  balance_micros: string; cycle_limit_micros: string; cycle_used_micros: string; reserved_micros: string;
  warning_percent: number;
};

export type RateRow = RowDataPacket & { metric: AiRateMetric; price_per_unit_micros: string; unit_scale: number };

async function lockAccount(connection: PoolConnection, businessId: string): Promise<AccountRow | null> {
  const [rows] = await connection.execute<AccountRow[]>(`SELECT * FROM business_ai_accounts WHERE business_id = ? FOR UPDATE`, [businessId]);
  return rows[0] ?? null;
}

async function advanceCycle(connection: PoolConnection, account: AccountRow, now: Date): Promise<AccountRow> {
  if (account.funding_mode !== 'account_limit' || account.cycle_mode === 'manual') return account;
  if (account.cycle_ends_at && now < account.cycle_ends_at) return account;
  const cycle = calculateCycle(account.cycle_mode, now, account.cycle_anchor_day, account.cycle_timezone);
  if (!cycle) return account;
  await connection.execute(
    `UPDATE business_ai_accounts SET cycle_started_at = ?, cycle_ends_at = ?, cycle_used_micros = 0, version = version + 1 WHERE business_id = ?`,
    [cycle.start, cycle.end, account.business_id],
  );
  await connection.execute(
    `INSERT IGNORE INTO ai_account_ledger (business_id, idempotency_key, entry_type, balance_after_micros, cycle_used_after_micros, reason)
     VALUES (?, ?, 'cycle_reset', ?, 0, 'automatic_cycle_reset')`,
    [account.business_id, `cycle:${account.business_id}:${cycle.start.toISOString()}`, account.balance_micros],
  );
  return { ...account, cycle_started_at: cycle.start, cycle_ends_at: cycle.end, cycle_used_micros: '0' };
}

export const AiBillingRepository = {
  async advanceDueCycles(now = new Date()): Promise<number> {
    const due = await query<{ business_id: string } & RowDataPacket>(
      `SELECT business_id FROM business_ai_accounts
        WHERE funding_mode='account_limit' AND cycle_mode <> 'manual'
          AND (cycle_ends_at IS NULL OR cycle_ends_at <= ?)` , [now],
    );
    let advanced = 0;
    for (const row of due) {
      const connection = await getPool().getConnection();
      try {
        await connection.beginTransaction();
        const account = await lockAccount(connection, row.business_id);
        if (account && (!account.cycle_ends_at || now >= account.cycle_ends_at)) {
          await advanceCycle(connection, account, now);
          advanced++;
        }
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }
    return advanced;
  },

  async getRates(planKey: string, modelId: string, at = new Date()): Promise<{ provider: RateRow[]; plan: RateRow[] }> {
    const [provider, plan] = await Promise.all([
      query<RateRow>(`SELECT r.metric, r.price_per_unit_micros, r.unit_scale FROM ai_provider_rates r WHERE r.provider = 'google' AND r.model_id = ? AND r.effective_from = (SELECT MAX(x.effective_from) FROM ai_provider_rates x WHERE x.provider=r.provider AND x.model_id=r.model_id AND x.metric=r.metric AND x.effective_from <= ? AND (x.effective_to IS NULL OR x.effective_to > ?))`, [modelId, at, at]),
      query<RateRow>(`SELECT r.metric, r.price_per_unit_micros, r.unit_scale FROM ai_plan_rates r WHERE r.plan_key = ? AND r.model_id = ? AND r.effective_from = (SELECT MAX(x.effective_from) FROM ai_plan_rates x WHERE x.plan_key=r.plan_key AND x.model_id=r.model_id AND x.metric=r.metric AND x.effective_from <= ? AND (x.effective_to IS NULL OR x.effective_to > ?))`, [planKey, modelId, at, at]),
    ]);
    return { provider, plan };
  },

  async reserve(input: AiBillingContext & { callKey: string; modelId: string; reservedMicros: bigint; rateSnapshot: unknown }): Promise<{ callId: number; enforcementMode: string }> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      let account = await lockAccount(connection, input.businessId);
      if (!account) throw new Error('AI account is not configured.');
      account = await advanceCycle(connection, account, new Date());
      const reserved = BigInt(account.reserved_micros);
      if (account.enforcement_mode === 'suspended') throw Object.assign(new Error('AI usage is suspended for this account.'), { reason: 'suspended' });
      if (account.enforcement_mode === 'enforce') {
        if (input.reservedMicros <= 0n) throw Object.assign(new Error('AI pricing is not configured for this model.'), { reason: 'pricing_unavailable' });
        if (account.funding_mode === 'prepaid' && BigInt(account.balance_micros) - reserved < input.reservedMicros) {
          throw Object.assign(new Error('AI credits have run out. Ask an administrator to restore credits.'), { reason: 'credits_exhausted' });
        }
        if (account.funding_mode === 'account_limit' && BigInt(account.cycle_used_micros) + reserved + input.reservedMicros > BigInt(account.cycle_limit_micros)) {
          throw Object.assign(new Error('The AI account limit has been reached. Ask an administrator to raise or reset the limit.'), { reason: 'account_limit_reached' });
        }
      }
      const [result] = await connection.execute<any>(
        `INSERT INTO ai_usage_calls (call_key, parent_call_id, business_id, area, operation, actor_type, actor_user_id, model_id, reference_type, reference_id, status, reserved_charge_micros, plan_rate_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`,
        [input.callKey, input.parentCallId ?? null, input.businessId, input.area, input.operation, input.actorType, input.actorUserId ?? null, input.modelId, input.referenceType ?? null, input.referenceId == null ? null : String(input.referenceId), input.reservedMicros.toString(), JSON.stringify(input.rateSnapshot)],
      );
      if (input.reservedMicros > 0n) await connection.execute(`UPDATE business_ai_accounts SET reserved_micros = reserved_micros + ?, version = version + 1 WHERE business_id = ?`, [input.reservedMicros.toString(), input.businessId]);
      await connection.commit();
      return { callId: Number(result.insertId), enforcementMode: account.enforcement_mode };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  },

  async markSubmitted(callId: number): Promise<void> {
    await getPool().execute(`UPDATE ai_usage_calls SET status = 'submitted', submitted_at = NOW(3) WHERE id = ? AND status = 'reserved'`, [callId]);
  },

  async settle(input: { callId: number; units: AiUsageUnits; providerCostMicros: bigint; tenantChargeMicros: bigint; providerRates: unknown; planRates: unknown }): Promise<void> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [calls] = await connection.execute<any[]>(`SELECT * FROM ai_usage_calls WHERE id = ? FOR UPDATE`, [input.callId]);
      const call = calls[0];
      if (!call || call.status === 'settled') { await connection.commit(); return; }
      const account = await lockAccount(connection, call.business_id);
      if (!account) throw new Error('AI account was removed before settlement.');
      const reserved = BigInt(call.reserved_charge_micros);
      const charged = input.tenantChargeMicros;
      const balance = account.funding_mode === 'prepaid' ? BigInt(account.balance_micros) - charged : BigInt(account.balance_micros);
      const cycleUsed = account.funding_mode === 'account_limit' ? BigInt(account.cycle_used_micros) + charged : BigInt(account.cycle_used_micros);
      await connection.execute(
        `UPDATE business_ai_accounts SET balance_micros = ?, cycle_used_micros = ?, reserved_micros = GREATEST(0, reserved_micros - ?), version = version + 1 WHERE business_id = ?`,
        [balance.toString(), cycleUsed.toString(), reserved.toString(), call.business_id],
      );
      await connection.execute(
        `UPDATE ai_usage_calls SET status = 'settled', input_tokens = ?, cached_input_tokens = ?, output_tokens = ?, thinking_tokens = ?, output_images = ?, video_seconds = ?, provider_cost_micros = ?, tenant_charge_micros = ?, provider_rate_snapshot = ?, plan_rate_snapshot = ?, settled_at = NOW(3) WHERE id = ?`,
        [input.units.inputTokens, input.units.cachedInputTokens, input.units.outputTokens + input.units.outputImageTokens, input.units.thinkingTokens, input.units.outputImages, input.units.videoSeconds, input.providerCostMicros.toString(), charged.toString(), JSON.stringify(input.providerRates), JSON.stringify(input.planRates), input.callId],
      );
      await connection.execute(
        `INSERT IGNORE INTO ai_account_ledger (business_id, idempotency_key, entry_type, amount_micros, balance_after_micros, cycle_used_after_micros, usage_call_id, reason)
         VALUES (?, ?, 'usage_charge', ?, ?, ?, ?, 'provider_usage')`,
        [call.business_id, `usage:${input.callId}`, (-charged).toString(), balance.toString(), cycleUsed.toString(), input.callId],
      );
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },

  async release(callId: number, status: 'released' | 'unknown', safeError?: string): Promise<void> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [calls] = await connection.execute<any[]>(`SELECT business_id, reserved_charge_micros, status FROM ai_usage_calls WHERE id = ? FOR UPDATE`, [callId]);
      const call = calls[0];
      if (!call || ['settled', 'released'].includes(call.status)) { await connection.commit(); return; }
      const releaseAmount = status === 'released' ? BigInt(call.reserved_charge_micros) : 0n;
      if (releaseAmount > 0n) await connection.execute(`UPDATE business_ai_accounts SET reserved_micros = GREATEST(0, reserved_micros - ?), version = version + 1 WHERE business_id = ?`, [releaseAmount.toString(), call.business_id]);
      await connection.execute(`UPDATE ai_usage_calls SET status = ?, safe_error = ?, settled_at = NOW(3) WHERE id = ?`, [status, safeError?.slice(0, 500) ?? null, callId]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },
};