/** @vitest-environment jsdom */
import React from 'react';
import { createHash, webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SECURITY_POLICIES } from '@/lib/securityCompliance/policies';
import SecurityPolicyEvidenceView from '../SecurityPolicyEvidenceView';

const fetchMock = vi.fn();
const onState = vi.fn();
const state = () => ({
  policies: SECURITY_POLICIES.map(policy => ({
    id: policy.id, hash: createHash('sha256').update(JSON.stringify(policy)).digest('hex'),
    adoptedAt: null, reviewedAt: null, nextReviewAt: null,
  })), lastLogReviewAt: null, nextLogReviewAt: null, history: [],
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const props = { revision: 3, blocked: false, onState, onHelp: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks(); fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('TextEncoder', TextEncoder);
  fetchMock.mockImplementation(async () => response({ success: true, state: state() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function ready() { await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ policies: expect.any(Array) }))); }

describe('explicit security review and adoption evidence', () => {
  it('never records a review or adoption merely by opening the workspace', async () => {
    render(<SecurityPolicyEvidenceView {...props} />); await ready();
    expect(fetchMock.mock.calls.every(([, options]) => options.method !== 'POST')).toBe(true);
    expect(screen.getByRole('button', { name: 'Record evidence' }).matches(':disabled')).toBe(true);
    expect(screen.getByText(/No automatic reminder email/)).toBeTruthy();
  });

  it('requires the saved responsibility revision and explicit human acknowledgement', async () => {
    const user = userEvent.setup();
    render(<SecurityPolicyEvidenceView {...props} />); await ready();
    await user.type(screen.getByRole('textbox', { name: 'Review/adoption summary' }), 'Reviewed authentication and hosting logs; follow-up recorded.');
    await user.type(screen.getByRole('textbox', { name: 'Safe evidence reference' }), 'Restricted review register');
    expect(screen.getByRole('button', { name: 'Record evidence' }).matches(':disabled')).toBe(true);
    await user.click(screen.getByRole('checkbox'));
    fetchMock.mockResolvedValueOnce(response({ success: true, record: { id: 7 } }));
    await user.click(screen.getByRole('button', { name: 'Record evidence' }));
    await screen.findByRole('status');
    const call = fetchMock.mock.calls.find(([, options]) => options.method === 'POST')!;
    expect(JSON.parse(call[1].body)).toMatchObject({
      policyId: 'logging-monitoring', kind: 'log_review', expectedRevision: 3, acknowledged: true,
      summary: 'Reviewed authentication and hosting logs; follow-up recorded.',
    });
    expect(JSON.parse(call[1].body)).not.toHaveProperty('actorUserId');
    expect(JSON.parse(call[1].body).operationKey).toMatch(/^[a-f0-9-]{36}$/);
  });

  it.each([{ revision: 0, blocked: false }, { revision: 3, blocked: true }])('blocks evidence for unsaved or dirty responsibilities', async overrides => {
    render(<SecurityPolicyEvidenceView {...props} {...overrides} />); await ready();
    expect(screen.getByRole('checkbox').matches(':disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Record evidence' }).matches(':disabled')).toBe(true);
  });

  it('does not attest to server policy text that differs from the displayed client text', async () => {
    const stale = state(); stale.policies[0].hash = 'a'.repeat(64);
    fetchMock.mockResolvedValueOnce(response({ success: true, state: stale }));
    render(<SecurityPolicyEvidenceView {...props} />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('policy text changed'));
    expect(onState).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('checkbox').matches(':disabled')).toBe(true);
  });

  it('clears parent adoption status when reloading evidence fails', async () => {
    const user = userEvent.setup();
    render(<SecurityPolicyEvidenceView {...props} />); await ready();
    fetchMock.mockResolvedValueOnce(response({ error: 'Evidence unavailable' }, 500));
    await user.click(screen.getByRole('button', { name: 'Reload evidence' }));
    await screen.findByRole('alert');
    expect(onState).toHaveBeenLastCalledWith(null);
  });

  it('pages authentication history using the last loaded ID and retains the original count', async () => {
    const user = userEvent.setup();
    render(<SecurityPolicyEvidenceView {...props} />); await ready();
    const entry = (id: number) => ({
      id, userId: null, actorUserId: null, businessId: null, eventType: 'login_failure', ipAddress: null,
      location: '', userAgent: null, recordedAt: '2026-10-15T12:00:00Z',
    });
    fetchMock.mockResolvedValueOnce(response({ success: true, logs: { totalCount: 2, hasMore: true, entries: [entry(9)] } }));
    await user.click(screen.getByRole('button', { name: 'Load platform authentication history' }));
    await screen.findByText(/1 loaded; 2 records matched/);
    fetchMock.mockResolvedValueOnce(response({ success: true, logs: { totalCount: 3, hasMore: false, entries: [entry(8)] } }));
    await user.click(screen.getByRole('button', { name: 'Load older authentication entries' }));
    await screen.findByText(/2 loaded; 2 records matched/);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('beforeId=9');
  });
});
