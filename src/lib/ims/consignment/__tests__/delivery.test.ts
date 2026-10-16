import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), report: vi.fn(), tracking: vi.fn(), detail: vi.fn() }));
vi.mock('../db', () => ({ query: mocks.query, execute: mocks.execute, transaction: mocks.transaction }));
vi.mock('../tracking', () => ({ requireTracking: mocks.tracking }));
vi.mock('../statements', () => ({ statementDetail: mocks.detail }));
vi.mock('../exports', () => ({ exportConsignment: vi.fn(async () => new Response('%PDF-mocked')) }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { DefinitiveDeliveryFailure, deliverStatement } from '../delivery';
const body = { recipient: 'supplier@example.com', acknowledge: true, requestKey: 'test-request-key-123' };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('RESEND_API_KEY', 'test-only-not-a-real-key'); vi.stubEnv('RESEND_FROM_EMAIL', 'test@example.com');
  mocks.execute.mockResolvedValue({ insertId: 17, affectedRows: 1 });
  mocks.query.mockResolvedValue([]);
  mocks.transaction.mockImplementation(async (_business, callback) => callback({}));
  mocks.tracking.mockResolvedValue({ interval: { id: 1 } });
  mocks.detail.mockResolvedValue({ statement: { id: 9, status: 'Finalised', number: 'CS-9', period_from: '2026-10-01', period_to: '2026-10-16',
    snapshot_json: { business: { name: 'Business' }, supplier: { name: 'Supplier' } } }, projection: { totals: { total: 11 } } });
});
afterEach(() => { vi.unstubAllEnvs(); });
describe('explicit supplier statement delivery', () => {
  it('commits Sending before transport and records provider acceptance, not proven delivery', async () => {
    let prepared = false;
    mocks.transaction.mockImplementation(async (_business, callback) => { const result = await callback({}); prepared = true; return result; });
    const transport = vi.fn(async (_input: { idempotencyKey: string }) => { expect(prepared).toBe(true); return 'provider-acceptance'; });
    const result = await deliverStatement('tenant-a', 1, 9, body, transport);
    expect(result).toEqual({ id: 17, status: 'Sent', providerReference: 'provider-acceptance', providerAccepted: true, deliveryConfirmed: false });
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0][0].idempotencyKey).toMatch(/^consignment-/);
    expect(mocks.execute.mock.calls.some(call => call[1].includes("'Sending'"))).toBe(true);
  });
  it('a repeated request key never calls transport twice', async () => {
    mocks.query.mockImplementation(async (_db, sql: string) => sql.includes('operation_key=?') ? [{ id: 17, status: 'Sent', recipient: body.recipient, provider_reference: 'provider-acceptance' }] : []);
    const transport = vi.fn();
    const result = await deliverStatement('tenant-a', 1, 9, body, transport);
    expect(result.status).toBe('Sent'); expect(transport).not.toHaveBeenCalled();
  });
  it('a connection failure is Unconfirmed and remains a disable/resend blocker', async () => {
    const result = await deliverStatement('tenant-a', 1, 9, body, vi.fn().mockRejectedValue(new Error('Network failed')));
    expect(result.status).toBe('Unconfirmed'); expect(result.providerAccepted).toBe(false); expect(mocks.report).toHaveBeenCalled();
  });
  it('a definitive provider rejection is Failed, never Sent', async () => {
    const result = await deliverStatement('tenant-a', 1, 9, body, vi.fn().mockRejectedValue(new DefinitiveDeliveryFailure('Rejected')));
    expect(result.status).toBe('Failed'); expect(result.providerReference).toBeNull();
  });
  it('blocks new attempts while any prior outcome is uncertain', async () => {
    mocks.query.mockImplementation(async (_db, sql: string) => sql.includes("IN ('Sending','Unconfirmed')") ? [{ id: 16, status: 'Unconfirmed' }] : []);
    const transport = vi.fn();
    await expect(deliverStatement('tenant-a', 1, 9, body, transport)).rejects.toThrow('unresolved');
    expect(transport).not.toHaveBeenCalled();
  });
  it('requires explicit resend confirmation and a reason for an accepted statement', async () => {
    mocks.query.mockImplementation(async (_db, sql: string) => sql.includes("status='Sent'") ? [{ id: 16, status: 'Sent' }] : []);
    await expect(deliverStatement('tenant-a', 1, 9, body, vi.fn())).rejects.toThrow('resend');
    await expect(deliverStatement('tenant-a', 1, 9, { ...body, resend: true }, vi.fn())).rejects.toThrow('Resend reason');
  });
  it('requires acknowledgement, configuration, and a valid single recipient', async () => {
    await expect(deliverStatement('tenant-a', 1, 9, { ...body, acknowledge: false }, vi.fn())).rejects.toThrow('Explicitly');
    await expect(deliverStatement('tenant-a', 1, 9, { ...body, recipient: 'a@example.com,b@example.com' }, vi.fn())).rejects.toThrow('one valid');
    vi.stubEnv('RESEND_API_KEY', '');
    await expect(deliverStatement('tenant-a', 1, 9, body, vi.fn())).rejects.toThrow('not configured');
  });
  it('reviewing an uncertain outcome records the audit without contacting a provider', async () => {
    mocks.query.mockResolvedValue([{ id: 17, status: 'Unconfirmed', recipient: body.recipient, age_seconds: 400 }]);
    const transport = vi.fn();
    const result = await deliverStatement('tenant-a', 1, 9, { action: 'resolve', acknowledge: true, deliveryId: 17, outcome: 'Failed', reason: 'Provider dashboard confirms rejected' }, transport);
    expect(result.status).toBe('Failed'); expect(transport).not.toHaveBeenCalled();
    expect(mocks.execute.mock.calls.some(call => call[2].includes('DeliveryReviewed'))).toBe(true);
  });
  it('does not permit review to race a fresh in-flight request', async () => {
    mocks.query.mockResolvedValue([{ id: 17, status: 'Sending', recipient: body.recipient, age_seconds: 2 }]);
    await expect(deliverStatement('tenant-a', 1, 9, { action: 'resolve', acknowledge: true, deliveryId: 17, outcome: 'Failed', reason: 'Test' }, vi.fn())).rejects.toThrow('uncertain or stale');
  });
});
