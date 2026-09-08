import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), get: vi.fn(), deletePayment: vi.fn(), imsQuery: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsSORepo: { get: mocks.get, deletePayment: mocks.deletePayment } }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));
vi.mock('@/services/MySQLService', () => ({ query: vi.fn() }));
import { DELETE } from '../route';

describe('DELETE SO payment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1' });
    mocks.get.mockResolvedValue({ payments: [{ id: 8 }] });
  });
  it('blocks deletion of an early-payment settlement', async () => {
    mocks.imsQuery.mockResolvedValue([{ id: 4 }]);
    const response = await DELETE({} as any, { params: { id: '42', pid: '8' } });
    expect(response.status).toBe(409);
    expect(mocks.imsQuery).toHaveBeenCalledWith(expect.stringContaining("document_type = 'sales_order'"), ['biz-1', 42, 8]);
    expect(mocks.deletePayment).not.toHaveBeenCalled();
  });
});