import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ assess: vi.fn(), setActivation: vi.fn() }));

vi.mock('../amazonReadiness', () => ({ assessAmazonReadiness: mocks.assess }));
vi.mock('../channelInstanceRepository', () => ({ SalesChannelInstanceRepository: {
  setAmazonActivationForBusiness: mocks.setActivation,
} }));

import { AmazonActivationBlockedError, setAmazonActivation } from '../amazonActivation';

describe('setAmazonActivation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assess.mockResolvedValue({ ready: true, checks: [{ key: 'authorization', passed: true }] });
    mocks.setActivation.mockResolvedValue({ channelInstanceId: 'instance-1', enabled: true, runtimeStatus: 'active' });
  });

  it('rechecks readiness before activating the exact instance', async () => {
    await expect(setAmazonActivation({
      businessId: 'business-1', channelInstanceId: 'instance-1', active: true, actorUserId: 7,
    })).resolves.toMatchObject({ instance: { enabled: true }, checks: [{ key: 'authorization', passed: true }] });
    expect(mocks.assess).toHaveBeenCalledWith({ businessId: 'business-1', channelInstanceId: 'instance-1' });
    expect(mocks.setActivation).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', active: true, actorUserId: 7,
    });
  });

  it('does not enable the instance when readiness has a blocker', async () => {
    const checks = [{ key: 'inventory', label: 'Inventory synchronization', passed: false, detail: 'Run Sync inventory successfully.' }];
    mocks.assess.mockResolvedValue({ ready: false, checks });

    await expect(setAmazonActivation({
      businessId: 'business-1', channelInstanceId: 'instance-1', active: true,
    })).rejects.toBeInstanceOf(AmazonActivationBlockedError);
    expect(mocks.setActivation).not.toHaveBeenCalled();
  });

  it('deactivates without calling Amazon or re-running readiness', async () => {
    mocks.setActivation.mockResolvedValue({ channelInstanceId: 'instance-1', enabled: false, runtimeStatus: 'paused' });

    await expect(setAmazonActivation({
      businessId: 'business-1', channelInstanceId: 'instance-1', active: false,
    })).resolves.toMatchObject({ instance: { enabled: false }, checks: null });
    expect(mocks.assess).not.toHaveBeenCalled();
  });
});