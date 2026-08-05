import {describe, expect, it, vi} from 'vitest';

import {claimLoyaltyReward, createCustomerAccountClient, loadLoyaltyState, parseLoyaltyState} from '../loyalty';

describe('Shopify loyalty customer state', () => {
  it('parses membership, signed balances, labels, and valid rewards', () => {
    const state = parseLoyaltyState({
      customer: {
        member: {value: 'true'},
        programActive: {value: 'true'},
        balancePoints: {value: '-25'},
        programName: {value: 'Store Club'},
        pointsLabel: {value: 'Stars'},
        rewards: {value: JSON.stringify([
          {rewardId: 3, code: 'ten-off', name: '$10 off', pointsCost: 100, valueAud: 10},
          {code: '', name: 'Invalid', pointsCost: 0, valueAud: 0},
        ])},
      },
    });

    expect(state).toEqual({
      member: true,
      programActive: true,
      balancePoints: -25,
      programName: 'Store Club',
      pointsLabel: 'Stars',
      rewards: [{rewardId: 3, code: 'ten-off', name: '$10 off', pointsCost: 100, valueAud: 10}],
    });
  });

  it('keeps legacy rewards visible without making up an internal reward ID', () => {
    const state = parseLoyaltyState({customer: {rewards: {value: JSON.stringify([
      {code: 'ten-off', name: '$10 off', pointsCost: 100, valueAud: 10},
    ])}}});
    expect(state.rewards[0]).toMatchObject({rewardId: null, code: 'ten-off'});
  });

  it('uses safe defaults for absent or malformed metafields', () => {
    expect(parseLoyaltyState({customer: {rewards: {value: '{broken'}}})).toEqual({
      member: false,
      programActive: false,
      balancePoints: 0,
      programName: 'Rewards Program',
      pointsLabel: 'points',
      rewards: [],
    });
  });

  it('rejects GraphQL errors without exposing their messages', async () => {
    const query = vi.fn().mockResolvedValue({errors: [{message: 'private Shopify detail'}]});
    await expect(loadLoyaltyState({query})).rejects.toThrow('Shopify could not load loyalty details.');
  });

  it('queries the authenticated Customer Account API without external network access', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({data: {customer: {balancePoints: {value: '125'}}}}),
    });

    const state = await loadLoyaltyState(createCustomerAccountClient(fetcher));

    expect(fetcher).toHaveBeenCalledWith(
      'shopify://customer-account/api/2026-07/graphql.json',
      expect.objectContaining({method: 'POST'}),
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(expect.objectContaining({
      query: expect.stringContaining('solvantis_loyalty'),
    }));
    expect(state.balancePoints).toBe(125);
  });

  it('claims a reward with the session token and stable request key', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({redemption: {
        id: 55, status: 'issued', voucherCode: 'SOLV-55-ABC', rewardName: '$10 off', rewardValueAud: 10, balanceAfter: 175,
      }}),
    });

    await expect(claimLoyaltyReward({
      rewardId: 3, idempotencyKey: 'claim_12345678',
      sessionToken: 'signed-token', fetcher,
    })).resolves.toMatchObject({voucherCode: 'SOLV-55-ABC', balanceAfter: 175});
    expect(fetcher).toHaveBeenCalledWith(
      'https://solvantis.com.au/api/shopify/loyalty/rewards',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({Authorization: 'Bearer signed-token'}),
        body: JSON.stringify({rewardId: 3, idempotencyKey: 'claim_12345678'}),
      }),
    );
  });
});
