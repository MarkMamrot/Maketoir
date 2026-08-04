import type { PoolConnection } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import { LoyaltyRepository, LoyaltyReturnBlockedError, LoyaltyValidationError } from '@/lib/ims/LoyaltyRepository';

function connectionWith(...results: unknown[]): { connection: PoolConnection; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  return { connection: { execute } as unknown as PoolConnection, execute };
}

const earnInput = {
  businessId: 'business-1',
  contactId: 42,
  type: 'earn' as const,
  pointsDelta: 25,
  channel: 'pos' as const,
  sourceType: 'pos_sale',
  sourceId: 101,
  idempotencyKey: 'pos:sale:101:earn',
};

const account = {
  id: 7,
  business_id: 'business-1',
  contact_id: 42,
  balance_points: 10,
  lifetime_earned: 10,
  lifetime_redeemed: 0,
  status: 'active',
};

const enrolledContact = {
  id: 42,
  type: 'retail_customer',
  is_active: 1,
  loyalty_member: 1,
};

describe('LoyaltyRepository', () => {
  it('locks the tenant account and writes the ledger before updating its cache', async () => {
    const { connection, execute } = connectionWith(
      [[]],
      [[enrolledContact]],
      [{ affectedRows: 1 }],
      [[account]],
      [[]],
      [{ insertId: 99 }],
      [{ affectedRows: 1 }],
    );

    const result = await LoyaltyRepository.applyTransaction(connection, earnInput);

    expect(result).toEqual({ transactionId: 99, accountId: 7, balanceAfter: 35, duplicate: false });
    expect(execute.mock.calls[1][0]).toContain('business_id = ?');
    expect(execute.mock.calls[1][1]).toEqual([42, 'business-1']);
    expect(execute.mock.calls[3][0]).toContain('FOR UPDATE');
    expect(execute.mock.calls[5][0]).toContain('INSERT INTO loyalty_transactions');
    expect(execute.mock.calls[6][0]).toContain('UPDATE loyalty_accounts');
    expect(execute.mock.calls[6][1]).toEqual([35, 25, 0, 7, 'business-1']);
  });

  it('returns the original result for an exact idempotent replay', async () => {
    const { connection, execute } = connectionWith([[{
      id: 99,
      account_id: 7,
      contact_id: 42,
      type: 'earn',
      points_delta: 25,
      balance_after: 35,
    }]]);

    await expect(LoyaltyRepository.applyTransaction(connection, earnInput)).resolves.toEqual({
      transactionId: 99,
      accountId: 7,
      balanceAfter: 35,
      duplicate: true,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects an idempotency key reused for a different mutation', async () => {
    const { connection } = connectionWith([[{
      id: 99,
      account_id: 7,
      contact_id: 42,
      type: 'earn',
      points_delta: 20,
      balance_after: 30,
    }]]);

    await expect(LoyaltyRepository.applyTransaction(connection, earnInput)).rejects.toThrow(
      'idempotency key was already used for a different loyalty transaction',
    );
  });

  it('prevents a redemption from taking the balance below zero', async () => {
    const { connection, execute } = connectionWith(
      [[]],
      [[enrolledContact]],
      [{ affectedRows: 1 }],
      [[{ ...account, balance_points: 10 }]],
      [[]],
    );

    await expect(LoyaltyRepository.applyTransaction(connection, {
      ...earnInput,
      type: 'redeem',
      pointsDelta: -20,
      idempotencyKey: 'reward:1:claim:abc',
    })).rejects.toBeInstanceOf(LoyaltyValidationError);
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it('rejects new points activity for a customer who has not opted in', async () => {
    const { connection, execute } = connectionWith(
      [[]],
      [[{ ...enrolledContact, loyalty_member: 0 }]],
    );

    await expect(LoyaltyRepository.applyTransaction(connection, earnInput)).rejects.toThrow(
      'not enrolled in the loyalty program',
    );
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toContain('loyalty_member');
  });

  it('allows a corrective reversal after the customer opts out', async () => {
    const { connection, execute } = connectionWith(
      [[]],
      [[{ ...enrolledContact, loyalty_member: 0 }]],
      [[{ ...account, balance_points: 10 }]],
      [[]],
      [{ insertId: 101 }],
      [{ affectedRows: 1 }],
    );

    await expect(LoyaltyRepository.applyTransaction(connection, {
      ...earnInput,
      type: 'redeem_reversal',
      pointsDelta: 20,
      idempotencyKey: 'pos:sale:101:reward:void',
      reason: 'POS sale voided',
    })).resolves.toEqual({ transactionId: 101, accountId: 7, balanceAfter: 30, duplicate: false });

    expect(execute.mock.calls[2][0]).toContain('FOR UPDATE');
    expect(execute.mock.calls.some(call => String(call[0]).includes('INSERT IGNORE INTO loyalty_accounts'))).toBe(false);
  });

  it('reserves a reward against the same locked ledger account', async () => {
    const { connection, execute } = connectionWith(
      [[]],
      [[{
        id: 3,
        business_id: 'business-1',
        reward_code: 'five-off',
        display_name: '$5 off',
        description: null,
        points_cost: 20,
        value_aud: 5,
        is_active: 1,
        sort_order: 0,
      }]],
      [[]],
      [[enrolledContact]],
      [{ affectedRows: 1 }],
      [[{ ...account, balance_points: 30 }]],
      [[]],
      [{ insertId: 100 }],
      [{ affectedRows: 1 }],
      [{ insertId: 55 }],
    );

    const result = await LoyaltyRepository.reserveReward(connection, {
      businessId: 'business-1',
      contactId: 42,
      rewardId: 3,
      idempotencyKey: 'reward:claim:abc',
      channel: 'pos',
      actorId: 'staff-1',
    });

    expect(result).toMatchObject({
      redemptionId: 55,
      transactionId: 100,
      accountId: 7,
      rewardId: 3,
      pointsDeducted: 20,
      balanceAfter: 10,
      status: 'reserved',
      duplicate: false,
    });
    expect(execute.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(execute.mock.calls[1][1]).toEqual([3, 'business-1']);
    expect(execute.mock.calls[9][0]).toContain('INSERT INTO loyalty_redemptions');
  });

  it('restores redeemed points before reversing points earned by a voided POS sale', async () => {
    const { connection, execute } = connectionWith(
      [[{ id: 55, contact_id: 42, points_deducted: 20 }]],
      [{ affectedRows: 1 }],
      [[{ id: 99, contact_id: 42, points_delta: 25 }]],
    );
    const applySpy = vi.spyOn(LoyaltyRepository, 'applyTransaction')
      .mockResolvedValueOnce({ transactionId: 102, accountId: 7, balanceAfter: 30, duplicate: false })
      .mockResolvedValueOnce({ transactionId: 103, accountId: 7, balanceAfter: 5, duplicate: false });

    await expect(LoyaltyRepository.reversePosSale(connection, {
      businessId: 'business-1',
      saleId: 101,
      actorId: 'manager-1',
    })).resolves.toEqual({
      redemptionReversals: [{ transactionId: 102, accountId: 7, balanceAfter: 30, duplicate: false }],
      earnReversals: [{ transactionId: 103, accountId: 7, balanceAfter: 5, duplicate: false }],
    });

    expect(applySpy.mock.calls[0][1]).toMatchObject({ type: 'redeem_reversal', pointsDelta: 20 });
    expect(applySpy.mock.calls[1][1]).toMatchObject({ type: 'earn_reversal', pointsDelta: -25 });
    expect(execute.mock.calls[1][0]).toContain("status = 'cancelled'");
    applySpy.mockRestore();
  });

  it('reverses the cumulative proportional points target for a linked POS return', async () => {
    const { connection } = connectionWith(
      [[{ id: 99, contact_id: 42, points_delta: 95 }]],
      [[{ points_delta: -30 }]],
    );
    const applySpy = vi.spyOn(LoyaltyRepository, 'applyTransaction').mockResolvedValueOnce({
      transactionId: 104,
      accountId: 7,
      balanceAfter: 33,
      duplicate: false,
    });

    await expect(LoyaltyRepository.reversePosReturn(connection, {
      businessId: 'business-1',
      originalSaleId: 101,
      returnSaleId: 202,
      originalEligibleCents: 9500,
      cumulativeReturnedCents: 6200,
      actorId: 'staff-1',
    })).resolves.toMatchObject({ transactionId: 104 });

    expect(applySpy).toHaveBeenCalledWith(connection, expect.objectContaining({
      contactId: 42,
      type: 'earn_reversal',
      pointsDelta: -32,
      sourceType: 'pos_sale_return',
      sourceId: 101,
      idempotencyKey: 'pos:return:202:earn:99',
    }));
    applySpy.mockRestore();
  });

  it('blocks a linked return when its earned points have already been spent', async () => {
    const { connection } = connectionWith(
      [[{ id: 99, contact_id: 42, points_delta: 95 }]],
      [[]],
    );
    const applySpy = vi.spyOn(LoyaltyRepository, 'applyTransaction').mockRejectedValueOnce(
      new LoyaltyValidationError('The customer does not have enough points.'),
    );

    await expect(LoyaltyRepository.reversePosReturn(connection, {
      businessId: 'business-1',
      originalSaleId: 101,
      returnSaleId: 202,
      originalEligibleCents: 9500,
      cumulativeReturnedCents: 9500,
    })).rejects.toBeInstanceOf(LoyaltyReturnBlockedError);
    applySpy.mockRestore();
  });
});