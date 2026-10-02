import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCookiesGet, mockGetImsSession, mockImsQuery, mockImsExecute, mockMkdir, mockWriteFile } = vi.hoisted(() => ({
  mockCookiesGet: vi.fn(),
  mockGetImsSession: vi.fn(),
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
  mockMkdir: vi.fn(),
  mockWriteFile: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookiesGet }) }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery, imsExecute: mockImsExecute }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));
vi.mock('node:fs/promises', () => ({
  default: { mkdir: mockMkdir, writeFile: mockWriteFile, unlink: vi.fn() },
}));

import { POST } from '../route';

function pettyCashRequest(registerSessionId = 91, gstTreatment = 'gst'): Request {
  const form = new FormData();
  form.set('operation_key', '12345678-1234-4123-8123-123456789abc');
  form.set('register_session_id', String(registerSessionId));
  form.set('amount', '22.00');
  form.set('reason', 'Cleaning supplies');
  form.set('gst_treatment', gstTreatment);
  form.set('receipt', new File(['receipt'], 'receipt.png', { type: 'image/png' }));
  return new Request('http://localhost/api/pos/petty-cash', { method: 'POST', body: form });
}

describe('POST /api/pos/petty-cash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookiesGet.mockReturnValue({
      value: JSON.stringify({
        pos_user_id: 17,
        full_name: 'QV Staff',
        location_id: 4,
        businessId: 'monsterthreads',
      }),
    });
    mockGetImsSession.mockResolvedValue({ businessId: 'monsterthreads' });
    mockImsExecute.mockResolvedValue({ insertId: 501 });
  });

  it('records against the authenticated location open session when the POS cookie has no register id', async () => {
    mockImsQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 91,
        register_id: 8,
        location_id: 4,
        session_date: '2026-10-02',
        status: 'open',
      }]);

    const response = await POST(pettyCashRequest());

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ success: true, id: 501, replayed: false });
    expect(mockImsExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pos_petty_cash_transactions'),
      expect.arrayContaining(['monsterthreads', 4, 8, 91]),
    );
  });

  it('rejects an open session from another location', async () => {
    mockImsQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 91,
        register_id: 8,
        location_id: 5,
        session_date: '2026-10-02',
        status: 'open',
      }]);

    const response = await POST(pettyCashRequest());

    expect(response.status).toBe(409);
    expect(mockImsExecute).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('records no GST when the receipt does not show GST', async () => {
    mockImsQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 91,
        register_id: 8,
        location_id: 4,
        session_date: '2026-10-02',
        status: 'open',
      }]);

    const response = await POST(pettyCashRequest(91, 'bas_excluded'));

    expect(response.status).toBe(201);
    expect(mockImsExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pos_petty_cash_transactions'),
      expect.arrayContaining([22, 'bas_excluded', 0, 'Cleaning supplies']),
    );
  });
});
