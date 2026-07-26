import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnectionsGet, mockSupplierCNGet, mockUpdateXeroDraftSupplierCreditNote } = vi.hoisted(() => ({
  mockConnectionsGet: vi.fn(),
  mockSupplierCNGet: vi.fn(),
  mockUpdateXeroDraftSupplierCreditNote: vi.fn(),
}));

vi.mock('@/lib/db/ConnectionsRepository', () => ({
  ConnectionsRepository: { get: mockConnectionsGet },
}));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsPORepo: {},
  ImsSORepo: {},
  ImsCNRepo: {},
  ImsSupplierCNRepo: { get: mockSupplierCNGet },
}));
vi.mock('@/services/XeroSyncService', () => ({
  syncPOAsDraftBill: vi.fn(),
  updateXeroDraftBill: vi.fn(),
  approveBill: vi.fn(),
  syncPOReceivedJournal: vi.fn(),
  syncPOPayment: vi.fn(),
  syncSOPayment: vi.fn(),
  syncSOAsInvoice: vi.fn(),
  updateXeroDraftInvoice: vi.fn(),
  approveInvoice: vi.fn(),
  markPoXeroStatus: vi.fn(),
  markSoXeroStatus: vi.fn(),
  voidXeroBill: vi.fn(),
  voidXeroInvoice: vi.fn(),
  syncCNAsCreditNote: vi.fn(),
  markCNXeroStatus: vi.fn(),
  syncSupplierCNAsCreditNote: vi.fn(),
  markSupplierCNXeroStatus: vi.fn(),
  voidXeroCreditNote: vi.fn(),
  voidXeroSupplierCreditNote: vi.fn(),
  updateXeroDraftSupplierCreditNote: mockUpdateXeroDraftSupplierCreditNote,
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ query: vi.fn() }));

import { triggerSupplierCNXeroUpdate } from '../xeroHooks';

describe('triggerSupplierCNXeroUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates the linked draft Xero credit note for an edited supplier credit note', async () => {
    mockConnectionsGet.mockResolvedValue({ xero_tenant_id: 'tenant', xero_refresh_token: 'token' });
    mockSupplierCNGet.mockResolvedValue({ id: 42, scn_number: 'SCN-00001', xero_credit_note_id: 'xero-123', status: 'draft' });
    mockUpdateXeroDraftSupplierCreditNote.mockResolvedValue(true);

    const warning = await triggerSupplierCNXeroUpdate('biz-1', 42);

    expect(warning).toBeNull();
    expect(mockUpdateXeroDraftSupplierCreditNote).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ id: 42, scn_number: 'SCN-00001' }),
      'xero-123',
    );
  });

  it('returns a warning when no Xero draft credit note exists yet', async () => {
    mockConnectionsGet.mockResolvedValue({ xero_tenant_id: 'tenant', xero_refresh_token: 'token' });
    mockSupplierCNGet.mockResolvedValue({ id: 42, scn_number: 'SCN-00001', xero_credit_note_id: null, status: 'draft' });

    const warning = await triggerSupplierCNXeroUpdate('biz-1', 42);

    expect(warning).toContain('not been synced to Xero yet');
    expect(mockUpdateXeroDraftSupplierCreditNote).not.toHaveBeenCalled();
  });
});
