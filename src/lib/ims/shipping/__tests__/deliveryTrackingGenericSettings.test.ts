import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELIVERY_TRACKING_CHANNELS_KEY } from '../deliveryTrackingSettingsRepository';

const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), execute: vi.fn(), channels: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/ims/businessOperations', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ims/businessOperations')>();
  return { ...actual, getOnlineChannelCapabilities: mocks.channels };
});
import { GET, PUT } from '@/app/api/ims/settings/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ businessId: 'tenant-a', tier: 'Admin' });
  mocks.channels.mockResolvedValue({ shopifyEnabled: false, nativeShopEnabled: false });
  mocks.query.mockImplementation(async (sql: string) => sql.includes('FROM ims_settings') ? [
    { key: DELIVERY_TRACKING_CHANNELS_KEY, value: '{"amazon":true,"shopify":false,"native_shop":false}' },
    { key: 'po_email_subject', value: 'Purchase Order {{order_number}}' },
  ] : [{ has_pos_locations: 0 }]);
});

describe('delivery preferences are owned by their validated workflow', () => {
  it('excludes the delivery map from generic snapshots so PO/SO drafts cannot overwrite newer switches', async () => {
    const result = await (await GET()).json();
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty(DELIVERY_TRACKING_CHANNELS_KEY);
    expect(result.data.po_email_subject).toBe('Purchase Order {{order_number}}');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each([DELIVERY_TRACKING_CHANNELS_KEY, DELIVERY_TRACKING_CHANNELS_KEY.toUpperCase(), `${DELIVERY_TRACKING_CHANNELS_KEY} `])(
    'rejects generic updates to the owned preference (%s) before any write', async key => {
      for (const body of [
        { key, value: '{}' },
        { settings: { po_email_subject: 'Updated', [key]: '{}' } },
      ]) {
        const response = await PUT(new Request('http://localhost/api/ims/settings', { method: 'PUT', body: JSON.stringify(body) }));
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: expect.stringContaining('delivery tracking switches') });
      }
      expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.report).not.toHaveBeenCalled();
    },
  );
});
