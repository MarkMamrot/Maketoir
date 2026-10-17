/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OnlineDailySalesSyncButton, shopifyOrderImportMessage } from '../OnlineSalesRequestFeedback';

function mockResponse(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const props = { businessId: 'business-1', channelInstanceId: 'store-1', date: '2026-10-15' };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('online order import feedback', () => {
  it('describes accepted recovery work as queued without inventing legacy counts', () => {
    const message = shopifyOrderImportMessage({ queued: true });
    expect(message).toContain('queued for scheduled recovery');
    expect(message).not.toMatch(/Imported 0|undefined|Import complete/);
    expect(message).toContain('have not finished importing');
  });

  it('retains completed legacy import counts and draft repairs', () => {
    expect(shopifyOrderImportMessage({ imported: 2, confirmed_drafts: 1, skipped_existing: 3 }))
      .toBe('✓ Imported 2 orders, fixed 1 stuck draft (3 already existed)');
    expect(shopifyOrderImportMessage({ imported: 0, skipped_existing: 4 }))
      .toBe('✓ Imported 0 orders (4 already existed)');
  });
});

describe('OnlineDailySalesSyncButton', () => {
  it.each(['Sync Xero', '↑ Sync Now'])('keeps %s queued rather than claiming Xero posting finished', async label => {
    const fetchMock = mockResponse({ success: false, queued: true, status: 'queued' }, 202);
    const onRefresh = vi.fn();
    render(<OnlineDailySalesSyncButton {...props} label={label} onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole('button', { name: label }));
    await screen.findByRole('button', { name: 'Xero queued' });
    expect(screen.getByRole('status').textContent).toContain('Xero posting is not confirmed');
    expect(screen.queryByText('Daily sales posting to Xero completed.')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/xero/sync/daily-sales', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ databaseId: 'business-1', date: '2026-10-15', channel: 'online', channelInstanceId: 'store-1' }),
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('prioritises queued over a success flag and a previously posted label', async () => {
    mockResponse({ success: true, queued: true }, 202);
    render(<OnlineDailySalesSyncButton {...props} initialStatus="ok" />);
    await userEvent.click(screen.getByRole('button', { name: '✓ Xero' }));
    await screen.findByRole('button', { name: 'Xero queued' });
    expect(screen.queryByRole('button', { name: '✓ Xero' })).toBeNull();
  });

  it.each([
    ['baseline_incomplete', 'Initial order coverage is incomplete.'],
    ['reconciliation_incomplete', 'Order catch-up is incomplete.'],
    ['order_review_required', 'An order requires review. Retrying does not clear that review.'],
    ['paused', 'Recovery is paused. Ask an administrator to resume recovery first.'],
    ['new_safe_readiness_code', 'new_safe_readiness_code'],
  ])('explains 409 readiness reason %s without offering a posting override', async (reason, explanation) => {
    mockResponse({ success: false, queued: false, reason, status: 'blocked' }, 409);
    const onRefresh = vi.fn();
    render(<OnlineDailySalesSyncButton {...props} onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sync Xero' }));
    await screen.findByRole('button', { name: 'Xero blocked' });
    expect(screen.getByRole('alert').textContent).toContain(explanation);
    expect(screen.getByRole('alert').textContent).toContain(`(${reason})`);
    expect(screen.getByRole('alert').textContent).toContain('there is no override');
    expect(screen.queryByRole('button', { name: '✓ Xero' })).toBeNull();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('preserves confirmed legacy posting success', async () => {
    mockResponse({ success: true, invoiceId: 'invoice-1' });
    const onRefresh = vi.fn();
    render(<OnlineDailySalesSyncButton {...props} onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sync Xero' }));
    await screen.findByRole('button', { name: '✓ Xero' });
    expect(screen.getByRole('status').textContent).toBe('Daily sales posting to Xero completed.');
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('does not treat an ambiguous 202 without queued acknowledgement as completed', async () => {
    mockResponse({ success: true }, 202);
    render(<OnlineDailySalesSyncButton {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sync Xero' }));
    await screen.findByRole('button', { name: '✗ Xero' });
    expect(screen.getByRole('alert').textContent).toContain('not confirmed');
  });

  it('preserves permission restrictions and reports rejection', async () => {
    const fetchMock = mockResponse({ error: 'Forbidden' }, 403);
    const { rerender } = render(<OnlineDailySalesSyncButton {...props} disabled />);
    await userEvent.click(screen.getByRole('button', { name: 'Sync Xero' }));
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(<OnlineDailySalesSyncButton {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sync Xero' }));
    await screen.findByText('You do not have permission to sync daily sales.');
  });

  it('requires an exact store and does not send requests when it is missing', async () => {
    const fetchMock = mockResponse({});
    render(<OnlineDailySalesSyncButton {...props} channelInstanceId="" />);
    await userEvent.click(screen.getByRole('button', { name: 'Sync Xero' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
