import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/ims/shipping/settings/route';
import { buildDimensionPresetInput } from '../shippingSettings';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), listAccounts: vi.fn(), listPresets: vi.fn(), savePreset: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('../shippingSettingsRepository', () => ({
  ShippingSettingsRepository: {
    listAccounts: mocks.listAccounts, listPresets: mocks.listPresets, savePreset: mocks.savePreset,
  },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

const preset = buildDimensionPresetInput('Regular parcel', { lengthCm: '25', widthCm: '16', heightCm: '8' });
const request = (data = preset) => new Request('http://localhost/api/ims/shipping/settings', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ resource: 'preset', businessId: 'tenant-b', data }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ businessId: 'tenant-a', tier: 'Admin' });
  mocks.listAccounts.mockResolvedValue([]);
  mocks.listPresets.mockResolvedValue([{ id: 11, ...preset }]);
  mocks.savePreset.mockResolvedValue(11);
});

describe('workstation dimension presets', () => {
  it('creates a preset only in the authenticated business, ignoring a body-supplied tenant', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, id: 11 });
    expect(mocks.savePreset).toHaveBeenCalledWith('tenant-a', preset);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('reloads the shared presets for the authenticated business', async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ success: true, data: { accounts: [], presets: [{ id: 11, ...preset }] } });
    expect(mocks.listPresets).toHaveBeenCalledWith('tenant-a');
  });

  it('blocks anonymous reads and writes', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect((await GET()).status).toBe(401);
    expect(mocks.savePreset).not.toHaveBeenCalled();
    expect(mocks.listPresets).not.toHaveBeenCalled();
  });

  it('allows advisors to read presets but not create them', async () => {
    mocks.session.mockResolvedValue({ businessId: 'tenant-a', tier: 'Advisor' });
    expect((await POST(request())).status).toBe(403);
    expect((await GET()).status).toBe(200);
    expect(mocks.savePreset).not.toHaveBeenCalled();
  });

  it('rejects invalid dimensions without a database write or runtime issue', async () => {
    const response = await POST(request({ ...preset, lengthMm: 0 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Length must be greater than 0 and no more than 10,000 mm.' });
    expect(mocks.savePreset).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('reports a duplicate name as a conflict rather than overwriting the preset or reporting an operational failure', async () => {
    mocks.savePreset.mockRejectedValue(Object.assign(new Error('duplicate name'), { code: 'ER_DUP_ENTRY' }));
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('already exists') });
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('records unexpected preset write failures with tenant-safe context', async () => {
    mocks.savePreset.mockRejectedValue(new Error('database unavailable'));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'tenant-a', operation: 'save_shipping_settings', context: { resource: 'preset' },
    }));
  });

  it('records preset reload failures instead of claiming the new preset list is available', async () => {
    mocks.listPresets.mockRejectedValue(new Error('database unavailable'));
    expect((await GET()).status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'tenant-a', operation: 'load_shipping_settings',
    }));
  });
});
