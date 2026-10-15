/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AmazonPiiDisposalView from '../AmazonPiiDisposalView';
const fetchMock = vi.fn();
const report = () => ({ businessId: 'tenant-a', salesOrderId: 42, amazonOrderReference: '111-2222222-3333333',
  earliestDeliveredAt: '2026-09-15T00:00:00.000Z', deadlineAt: '2026-10-15T00:00:00.000Z',
  generatedAt: '2026-10-15T00:00:00.000Z', expiresAt: '2026-10-15T00:15:00.000Z',
  token: 'a'.repeat(64), blockers: [], fieldsToClear: [{ source: 'Order address', fields: 7, records: 1 }],
  alreadyCleared: false, copyReviewRequired: true });
beforeEach(() => {
  fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('crypto', { randomUUID: () => '12345678-1234-4234-9234-123456789abc' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('explicit identifying-field approval', () => {
  it('does not read or delete on mount', async () => {
    const help = vi.fn();
    render(<AmazonPiiDisposalView onHelp={help} />);
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Amazon cleanup help' }));
    expect(help).toHaveBeenCalledOnce();
  });
  it('requires typed confirmation and carries the preview tenant/token, not buyer data', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, report: report() })));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: {
      salesOrderId: 42, structuredFieldsCleared: true, copyReviewRequired: true,
    } })));
    const user = userEvent.setup();
    render(<AmazonPiiDisposalView onHelp={() => {}} />);
    await user.type(screen.getByRole('textbox', { name: 'Local Amazon sales order ID' }), '42');
    await user.click(screen.getByRole('button', { name: 'Preview cleanup' }));
    const button = await screen.findByRole('button', { name: 'Approve identifying-field cleanup' });
    expect(button.hasAttribute('disabled')).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Type CLEAR AMAZON PII 42' }), 'CLEAR AMAZON PII 42');
    await user.click(button);
    await screen.findByText(/Identifying fields cleared. Necessary order/);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      expectedBusinessId: 'tenant-a', salesOrderId: 42, token: 'a'.repeat(64), confirmation: 'CLEAR AMAZON PII 42',
    });
    expect(screen.queryByRole('button', { name: 'Approve identifying-field cleanup' })).toBeNull();
    expect(screen.getByText(/not certification that all copies/)).toBeTruthy();
  });
  it('shows blockers and never offers an approval fallback', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, report: { ...report(), blockers: ['Shared customer requires manual resolution.'] } })));
    render(<AmazonPiiDisposalView onHelp={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Local Amazon sales order ID' }), '42');
    await user.click(screen.getByRole('button', { name: 'Preview cleanup' }));
    await screen.findByText('Shared customer requires manual resolution.');
    expect(screen.queryByRole('button', { name: 'Approve identifying-field cleanup' })).toBeNull();
  });
});
