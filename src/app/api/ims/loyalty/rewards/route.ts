import { NextResponse } from 'next/server';

import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { LoyaltyRepository } from '@/lib/ims/LoyaltyRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminTier } from '@/lib/sessionUtils';
import { imsExecute } from '@/services/IMSMySQLService';

interface RewardInput {
  id?: number;
  rewardCode?: string;
  displayName?: string;
  description?: string | null;
  pointsCost?: number;
  valueAud?: number;
  isActive?: boolean;
  sortOrder?: number;
}

function validateReward(input: RewardInput, index: number) {
  const id = Number(input.id || 0);
  const rewardCode = String(input.rewardCode || '').trim().toUpperCase();
  const displayName = String(input.displayName || '').trim();
  const description = String(input.description || '').trim() || null;
  const pointsCost = Number(input.pointsCost);
  const valueAud = Number(input.valueAud);
  const sortOrder = Number(input.sortOrder ?? index);
  if (id && (!Number.isInteger(id) || id < 1)) throw new Error('Reward ID is invalid.');
  if (!/^[A-Z0-9_-]{1,50}$/.test(rewardCode)) throw new Error('Reward code must use letters, numbers, hyphens, or underscores.');
  if (!displayName || displayName.length > 255) throw new Error('Reward name is required and must be 255 characters or fewer.');
  if (!Number.isInteger(pointsCost) || pointsCost < 1 || pointsCost > 10_000_000) throw new Error('Points cost must be a whole number from 1 to 10,000,000.');
  if (!Number.isFinite(valueAud) || valueAud <= 0 || valueAud > 100_000) throw new Error('Reward value must be greater than $0 and no more than $100,000.');
  if (!Number.isInteger(sortOrder)) throw new Error('Reward display order is invalid.');
  return { id, rewardCode, displayName, description, pointsCost, valueAud: Math.round(valueAud * 100) / 100, isActive: input.isActive !== false, sortOrder };
}

export async function GET() {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  try {
    const rewards = await runImsForBusiness(auth.user.businessId, () => LoyaltyRepository.listRewards(auth.user.businessId, false));
    return NextResponse.json({ success: true, rewards });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'loyalty_settings', operation: 'load_rewards', title: 'Loyalty rewards could not be loaded', error }).catch(() => {});
    return NextResponse.json({ error: 'Loyalty rewards could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  let body: { rewards?: RewardInput[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'A valid JSON body is required.' }, { status: 400 }); }
  if (!Array.isArray(body.rewards) || body.rewards.length > 100) return NextResponse.json({ error: 'Rewards must be an array of no more than 100 items.' }, { status: 400 });
  let rewards;
  try {
    rewards = body.rewards.map(validateReward);
    if (new Set(rewards.map(reward => reward.rewardCode)).size !== rewards.length) throw new Error('Reward codes must be unique.');
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Reward settings are invalid.' }, { status: 400 });
  }
  try {
    await runImsForBusiness(auth.user.businessId, async () => {
      for (const reward of rewards) {
        if (reward.id) {
          const result = await imsExecute(
            `UPDATE loyalty_rewards
                SET reward_code = ?, display_name = ?, description = ?, points_cost = ?, value_aud = ?, is_active = ?, sort_order = ?
              WHERE id = ? AND business_id = ?`,
            [reward.rewardCode, reward.displayName, reward.description, reward.pointsCost, reward.valueAud, reward.isActive ? 1 : 0, reward.sortOrder, reward.id, auth.user.businessId],
          );
          if (!result.affectedRows) throw new Error('A reward no longer exists or belongs to another business.');
        } else {
          await imsExecute(
            `INSERT INTO loyalty_rewards
              (business_id, reward_code, display_name, description, points_cost, value_aud, is_active, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [auth.user.businessId, reward.rewardCode, reward.displayName, reward.description, reward.pointsCost, reward.valueAud, reward.isActive ? 1 : 0, reward.sortOrder],
          );
        }
      }
    });
    const saved = await runImsForBusiness(auth.user.businessId, () => LoyaltyRepository.listRewards(auth.user.businessId, false));
    return NextResponse.json({ success: true, rewards: saved });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY') return NextResponse.json({ error: 'Each reward code must be unique.' }, { status: 409 });
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'loyalty_settings', operation: 'save_rewards', title: 'Loyalty rewards could not be saved', error }).catch(() => {});
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Loyalty rewards could not be saved.' }, { status: 500 });
  }
}