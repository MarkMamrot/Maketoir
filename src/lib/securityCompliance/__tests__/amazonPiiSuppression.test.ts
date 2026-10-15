import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
import { assertShippingPiiNotCleared, isAmazonOrderPiiCleared } from '../amazonPiiSuppression';

beforeEach(() => vi.resetAllMocks());
describe('durable Amazon re-import suppression', () => {
  it('preserves pre-rollout imports when no cleanup storage exists', async () => {
    mocks.query.mockResolvedValue([]);
    expect(await isAmazonOrderPiiCleared('tenant-a', 42)).toBe(false);
    expect(mocks.query).toHaveBeenCalledOnce();
  });
  it('checks the exact tenant and local order and fails closed on storage errors', async () => {
    mocks.query.mockResolvedValueOnce([{ present: 1 }]).mockResolvedValueOnce([{ so_id: 42 }]);
    expect(await isAmazonOrderPiiCleared('tenant-a', 42)).toBe(true);
    expect(mocks.query.mock.calls[1][1]).toEqual(['tenant-a', 42]);
    mocks.query.mockRejectedValueOnce(new Error('Unavailable'));
    await expect(isAmazonOrderPiiCleared('tenant-a', 42)).rejects.toThrow('Unavailable');
  });
  it('blocks label or carrier-copy regeneration using tenant-owned shipment associations', async () => {
    mocks.query.mockResolvedValueOnce([{ present: 1 }]).mockResolvedValueOnce([{ so_id: 42 }]);
    await expect(assertShippingPiiNotCleared('tenant-a', [7, 8])).rejects.toThrow('cannot be regenerated');
    expect(mocks.query.mock.calls[1][1]).toEqual(['tenant-a', 7, 8]);
  });
});
