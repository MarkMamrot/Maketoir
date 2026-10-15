/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AmazonDeliveryEvidenceView from '../AmazonDeliveryEvidenceView';

const fetchMock = vi.fn();
const operationKey = '12345678-1234-4234-9234-123456789abc';
const report = () => ({ salesOrderId: 42, earliestVerifiedDeliveryAt: null, reviewDeadlineAt: null, hasMoreHistory: false,
  parcels: [{ id: 9, shipmentId: 8, parcelNumber: 1, automaticTracking: true, lastCheckedAt: null, outcome: null }], history: [] });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('crypto', { randomUUID: () => operationKey });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function load() {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'Local Amazon sales order ID' }), '42');
  await user.click(screen.getByRole('button', { name: 'Load delivery evidence' }));
  await screen.findByRole('heading', { name: 'Manual verification fallback' });
  return user;
}

describe('manual Amazon delivery evidence workspace', () => {
  it('does not scan or poll on mount and provides contextual Help', async () => {
    const help = vi.fn();
    render(<AmazonDeliveryEvidenceView onHelp={help} />);
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Delivery evidence help' }));
    expect(help).toHaveBeenCalledOnce();
    expect(screen.getByText(/hourly job starts Off/)).toBeTruthy();
  });
  it('requires independent verification and saves minimum fields only', async () => {
    fetchMock.mockResolvedValueOnce(response({ success: true, report: report() }));
    fetchMock.mockResolvedValueOnce(response({ success: true, evidenceId: 7 }));
    render(<AmazonDeliveryEvidenceView onHelp={() => {}} />);
    const user = await load();
    expect(screen.getByRole('button', { name: 'Save verified delivery' }).hasAttribute('disabled')).toBe(true);
    await user.type(screen.getByRole('textbox', { name: /Verified delivery timestamp/ }), '2025-09-01T10:00:00+10:00');
    await user.type(screen.getByRole('textbox', { name: /Non-personal evidence code/ }), 'TICKET-123');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Save verified delivery' }));
    await screen.findByText(/Saved evidence record #7/);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      action: 'record', salesOrderId: 42, parcelId: null, deliveredAt: '2025-09-01T10:00:00+10:00',
      basis: 'carrier-portal', reference: 'TICKET-123', verified: true, operationKey,
    });
    expect(screen.queryByRole('heading', { name: 'Manual verification fallback' })).toBeNull();
  });
  it('refuses unzoned manual dates without sending a mutation', async () => {
    fetchMock.mockResolvedValueOnce(response({ success: true, report: report() }));
    render(<AmazonDeliveryEvidenceView onHelp={() => {}} />);
    const user = await load();
    await user.type(screen.getByRole('textbox', { name: /Verified delivery timestamp/ }), '2025-09-01T10:00:00');
    await user.type(screen.getByRole('textbox', { name: /Non-personal evidence code/ }), 'TICKET-123');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Save verified delivery' }));
    expect((await screen.findByRole('alert')).textContent).toContain('explicit timezone');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('requires explicit confirmation to append a factual correction', async () => {
    fetchMock.mockResolvedValueOnce(response({ success: true, report: {
      ...report(), earliestVerifiedDeliveryAt: '2025-09-01T00:00:00.000Z', reviewDeadlineAt: '2025-10-01T00:00:00.000Z',
      history: [{ id: 7, parcelId: null, kind: 'delivery', source: 'manual', deliveredAt: '2025-09-01T00:00:00.000Z',
        recordedAt: '2025-09-02T00:00:00.000Z', basis: 'carrier-portal', reference: 'TICKET-123', actorUserId: 99, voidsEvidenceId: null, active: true }],
    } }));
    fetchMock.mockResolvedValueOnce(response({ success: true, evidenceId: 8 }));
    render(<AmazonDeliveryEvidenceView onHelp={() => {}} />);
    const user = await load();
    await user.click(screen.getByRole('button', { name: 'Void incorrect manual evidence #7' }));
    expect(fetchMock).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Confirm factual correction' }));
    await screen.findByText(/Saved evidence record #8/);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: 'void', salesOrderId: 42, evidenceId: 7, reason: 'wrong-date', operationKey });
  });
  it('clears stale results on a failed reload rather than showing empty success', async () => {
    fetchMock.mockResolvedValueOnce(response({ success: true, report: report() }));
    fetchMock.mockResolvedValueOnce(response({ error: 'Storage unavailable' }, 503));
    render(<AmazonDeliveryEvidenceView onHelp={() => {}} />);
    const user = await load();
    await user.click(screen.getByRole('button', { name: 'Load delivery evidence' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('heading', { name: 'Manual verification fallback' })).toBeNull();
  });
});
