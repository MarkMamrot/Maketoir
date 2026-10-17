/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import OnlineSalesRecoveryPanel from '../OnlineSalesRecoveryPanel';

const channel = {
  channelInstanceId: 'store-1',
  displayName: 'Retail store',
  baselineComplete: false,
  coveredThrough: '2026-10-16T04:00:00Z',
  nextCheckAt: '2026-10-17T04:00:00Z',
  safeErrorCode: 'PROVIDER_UNAVAILABLE',
  pendingJobs: 3,
  failedJobs: 2,
  reviewOrderCount: 1,
  reviewOrdersTruncated: false,
  reviewOrders: [{ externalOrderId: '#1042', reason: 'Late change to posted day' }],
};

const snapshot = {
  mode: 'cutover' as 'legacy' | 'validation' | 'cutover',
  paused: false,
  channels: [channel, { ...channel, channelInstanceId: 'store-2', displayName: 'Wholesale store',
    baselineComplete: true, coveredThrough: null, nextCheckAt: null, safeErrorCode: null, pendingJobs: 0, failedJobs: 0,
    reviewOrderCount: 0, reviewOrdersTruncated: false, reviewOrders: [] }],
};

function response(body: unknown = snapshot, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockStatus(body: unknown = snapshot) {
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response(body)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OnlineSalesRecoveryPanel', () => {
  it('distinguishes recent coverage and accounting dates from held historical work', async () => {
    mockStatus({ ...snapshot, channels: [{
      ...channel, recoveryFrom: '2026-10-10T00:00:00Z', accountingFrom: '2026-10-18', heldHistoricalJobs: 107,
    }] });
    render(<OnlineSalesRecoveryPanel />);
    expect(await screen.findByText('Recovery coverage from')).toBeTruthy();
    expect(screen.getByText('Scheduled accounting from').nextElementSibling?.textContent).toBe('2026-10-18');
    expect(screen.getByText('Historical work held').nextElementSibling?.textContent).toBe('107');
    expect(screen.getByText(/Only the displayed recovery window is verified/)).toBeTruthy();
  });
  it('shows separate baseline, coverage, queued, failed and review status for each exact store', async () => {
    const fetchMock = mockStatus();
    render(<OnlineSalesRecoveryPanel canManage />);
    const retail = await screen.findByRole('region', { name: 'Retail store recovery' });
    const wholesale = screen.getByRole('region', { name: 'Wholesale store recovery' });
    expect(within(retail).getByText('Incomplete — catch-up required')).toBeTruthy();
    expect(within(retail).getByText('3')).toBeTruthy();
    expect(within(retail).getByText('2')).toBeTruthy();
    expect(within(retail).getByText('1')).toBeTruthy();
    expect(within(retail).getByText('#1042')).toBeTruthy();
    expect(within(retail).getByText(/PROVIDER_UNAVAILABLE/)).toBeTruthy();
    expect(within(retail).getByText('Incremental coverage through').nextElementSibling?.textContent).not.toBe('Not yet confirmed');
    expect(within(wholesale).getByText('Complete')).toBeTruthy();
    expect(within(wholesale).getByText('Not yet confirmed')).toBeTruthy();
    expect(within(wholesale).getByText('Not scheduled')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Online sales recovery' }).getAttribute('data-help-context')).toBe('online-sales-recovery');
    expect(fetchMock).toHaveBeenCalledWith('/api/ims/online-sales/recovery', expect.objectContaining({ cache: 'no-store' }));
    expect(screen.getByText(/Manual posting stays blocked/).textContent).toContain('no override');
    expect(screen.getByText(/Recovered refunds/).textContent).toContain('never charges or refunds the customer again');
    expect(screen.queryByRole('button', { name: /clear.review|force.ready|post/i })).toBeNull();
  });

  it('requests only the exact storefront retry, refreshes status, and retains posted-day review', async () => {
    const user = userEvent.setup();
    const fetchMock = mockStatus();
    render(<OnlineSalesRecoveryPanel canManage />);
    await user.click(await screen.findByRole('button', { name: 'Retry recovery for Retail store' }));
    await screen.findByText(/Retry requested/);
    const posts = fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual(['/api/ims/online-sales/recovery', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'retry', channelInstanceId: 'store-1' }),
    }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByText('#1042')).toBeTruthy();
    expect(screen.getByText(/retry does not approve them/)).toBeTruthy();
  });

  it('shows the total review count and explicitly identifies a truncated list', async () => {
    const reviewOrders = Array.from({ length: 30 }, (_, index) => ({
      externalOrderId: `#${2000 + index}`, reason: 'Late change to posted day',
    }));
    mockStatus({ ...snapshot, channels: [{ ...channel, reviewOrderCount: 47, reviewOrdersTruncated: true, reviewOrders }] });
    render(<OnlineSalesRecoveryPanel />);
    const retail = await screen.findByRole('region', { name: 'Retail store recovery' });
    expect(within(retail).getByText('Orders needing review').nextElementSibling?.textContent).toBe('47');
    expect(within(retail).getByText('Showing 30 of 47 orders needing review. This is not the full review list.')).toBeTruthy();
    expect(within(retail).getAllByRole('listitem')).toHaveLength(30);
  });

  it('does not describe an untruncated review list as incomplete', async () => {
    mockStatus();
    render(<OnlineSalesRecoveryPanel />);
    await screen.findByText('#1042');
    expect(screen.queryByText(/This is not the full review list/)).toBeNull();
  });

  it('does not treat a complete native baseline as completed gift card or accounting work', async () => {
    mockStatus({ ...snapshot, channels: [{
      ...channel, displayName: 'Native store', baselineComplete: true, safeErrorCode: 'gift_card_review_required',
    }] });
    render(<OnlineSalesRecoveryPanel />);
    const native = await screen.findByRole('region', { name: 'Native store recovery' });
    expect(within(native).getByText('Complete')).toBeTruthy();
    expect(within(native).getByText('2')).toBeTruthy();
    expect(screen.getByText(/Baseline completion confirms initial order coverage only, not completion of gift card or accounting work/)).toBeTruthy();
    expect(screen.getByText(/remain failed until an explicit retry after the cause is addressed/)).toBeTruthy();
  });

  it.each([
    ['awaiting_reconciliation', 'Awaiting order reconciliation'],
    ['rebaseline_required', 'Baseline refresh required'],
    ['accounting_review_required', 'Accounting review required'],
    ['gift_card_review_required', 'Gift card review required'],
    ['order_review_required', 'Order review required'],
    ['configuration_blocked', 'Recovery configuration needs attention'],
    ['PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE'],
  ])('labels safe recovery issue %s without losing unknown-code fallbacks', async (code, label) => {
    mockStatus({ ...snapshot, channels: [{ ...channel, safeErrorCode: code }] });
    render(<OnlineSalesRecoveryPanel />);
    expect(await screen.findByText(`Recovery issue: ${label}`)).toBeTruthy();
  });

  it('handles a retry rejected because recovery was paused elsewhere, then refreshes the paused state', async () => {
    const user = userEvent.setup();
    const fetchMock = mockStatus();
    render(<OnlineSalesRecoveryPanel canManage />);
    await screen.findByRole('button', { name: 'Retry recovery for Retail store' });
    fetchMock.mockResolvedValueOnce(response({}, 409)).mockResolvedValueOnce(response({ ...snapshot, paused: true }));
    await user.click(screen.getByRole('button', { name: 'Retry recovery for Retail store' }));
    await screen.findByText('Recovery is paused. Resume recovery before requesting a retry.');
    await screen.findByRole('button', { name: 'Resume recovery' });
    expect((screen.getByRole('button', { name: 'Retry recovery for Retail store' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/Retry requested/)).toBeNull();
    expect(screen.getByText('#1042')).toBeTruthy();
  });

  it('pauses and resumes recovery globally without restoring historical scans', async () => {
    const user = userEvent.setup();
    let paused = false;
    const fetchMock = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') paused = JSON.parse(String(options.body)).action === 'pause';
      return Promise.resolve(response({ ...snapshot, paused }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<OnlineSalesRecoveryPanel canManage />);
    await user.click(await screen.findByRole('button', { name: 'Pause recovery' }));
    await screen.findByRole('button', { name: 'Resume recovery' });
    expect((screen.getByRole('button', { name: 'Retry recovery for Retail store' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/does not restore old historical scans/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Resume recovery' }));
    await screen.findByRole('button', { name: 'Pause recovery' });
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => JSON.parse(String(options.body))))
      .toEqual([{ action: 'pause' }, { action: 'resume' }]);
  });

  it('keeps non-admin and Advisor access read-only while allowing status refresh', async () => {
    const user = userEvent.setup();
    const fetchMock = mockStatus();
    render(<OnlineSalesRecoveryPanel />);
    await screen.findByRole('region', { name: 'Retail store recovery' });
    expect(screen.queryByRole('button', { name: /Retry recovery|Pause recovery|Resume recovery/ })).toBeNull();
    expect(screen.getByText(/Advisor accounting-sync access does not grant/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Refresh recovery status' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true);
  });

  it('shows legacy unavailability without advertising activation or changing existing runtime', async () => {
    const fetchMock = mockStatus({ ...snapshot, mode: 'legacy' });
    render(<OnlineSalesRecoveryPanel canManage />);
    await screen.findByText(/unavailable until rollout/);
    expect(screen.getByText(/Current order synchronization continues unchanged/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Retry recovery|Pause recovery|Resume recovery|Activate/ })).toBeNull();
    expect(screen.queryByText(/no longer triggers/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('distinguishes validation from verified cutover', async () => {
    mockStatus({ ...snapshot, mode: 'validation' });
    render(<OnlineSalesRecoveryPanel canManage />);
    await screen.findByText(/Existing catch-up behaviour remains in place until verified cutover/);
    expect(screen.queryByText(/no longer triggers/)).toBeNull();
  });

  it('handles unavailable or malformed status and offers a safe read-only refresh', async () => {
    const user = userEvent.setup();
    const fetchMock = mockStatus({ ...snapshot, channels: [{}] });
    render(<OnlineSalesRecoveryPanel canManage />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Pause recovery' })).toBeNull();
    fetchMock.mockResolvedValueOnce(response());
    await user.click(screen.getByRole('button', { name: 'Refresh recovery status' }));
    await screen.findByRole('button', { name: 'Pause recovery' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not expose server error bodies when a read fails', async () => {
    const fetchMock = mockStatus();
    fetchMock.mockResolvedValueOnce(response({ error: 'private operational detail' }, 500));
    render(<OnlineSalesRecoveryPanel canManage />);
    await screen.findByText(/Recovery status could not be loaded/);
    expect(screen.queryByText(/private operational detail/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause recovery' })).toBeNull();
  });

  it('reports permission rejection instead of announcing retry success', async () => {
    const user = userEvent.setup();
    const fetchMock = mockStatus();
    render(<OnlineSalesRecoveryPanel canManage />);
    await screen.findByRole('button', { name: 'Retry recovery for Retail store' });
    fetchMock.mockResolvedValueOnce(response({}, 403));
    await user.click(screen.getByRole('button', { name: 'Retry recovery for Retail store' }));
    await screen.findByText('You do not have permission to change recovery controls.');
    expect(screen.queryByText(/Retry requested/)).toBeNull();
  });

  it('locks mutations while one request is pending and fails closed on an unconfirmed result', async () => {
    const user = userEvent.setup();
    const fetchMock = mockStatus();
    render(<OnlineSalesRecoveryPanel canManage />);
    await screen.findByRole('button', { name: 'Retry recovery for Retail store' });
    let reject!: (error: Error) => void;
    fetchMock.mockImplementationOnce(() => new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }));
    await user.click(screen.getByRole('button', { name: 'Retry recovery for Retail store' }));
    expect((screen.getByRole('button', { name: 'Pause recovery' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Retry recovery for Wholesale store' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Pause recovery' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    reject(new Error('network'));
    await screen.findByText(/could not be confirmed/);
    expect(screen.queryByRole('button', { name: 'Pause recovery' })).toBeNull();
  });

  it('shows an empty channel list without treating it as posting readiness', async () => {
    mockStatus({ ...snapshot, channels: [] });
    render(<OnlineSalesRecoveryPanel canManage />);
    await screen.findByText('No online channels are reporting recovery status.');
    expect(screen.getByText(/Manual posting stays blocked/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Retry recovery/ })).toBeNull();
  });
});
