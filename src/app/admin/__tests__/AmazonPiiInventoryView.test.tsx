/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AMAZON_PII_SOURCES } from '@/lib/securityCompliance/amazonPiiInventory';
import AmazonPiiInventoryView from '../AmazonPiiInventoryView';

function report(afterId = 0, nextAfterId: number | null = null) {
  return {
    mode: 'read-only', generatedAt: '2026-10-15T00:00:00.000Z', afterId, nextAfterId,
    summary: { amazonOrders: 27, ordersWithPotentialPii: 20, ordersWithStructuredFields: 12,
      ordersWithUnreviewedContent: 15, agedOrdersNeedingReview: 5, confirmedOverdue: null },
    deliveryEvidence: { availability: 'available', ordersWithVerifiedDelivery: 0, ordersPastReviewDeadline: 0 },
    sources: AMAZON_PII_SOURCES.map(source => ({ id: source.id, availability: 'available', records: 2 })),
    orders: [{ salesOrderId: afterId + 1, amazonOrderReference: '123-1234567-1234567',
      orderDate: '2026-09-15', ageDays: 30, sourceIds: ['order-address', 'shipment-amendment'], earliestVerifiedDeliveryAt: null, reviewDeadlineAt: null }],
  };
}
const fetchMock = vi.fn();
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Amazon PII inventory workspace', () => {
  it('does not scan on mount and explains the delivery and external-copy limitations', () => {
    render(<AmazonPiiInventoryView onHelp={() => {}} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Evidence-based review, not automatic deletion')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Outside the automatic scan' })).toBeTruthy();
  });

  it('runs a GET-only scan and shows review candidates without an overdue conclusion', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response({ success: true, report: report() }));
    render(<AmazonPiiInventoryView onHelp={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Run read-only inventory' }));
    await screen.findByText('Sales order #1');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('?after=0'), expect.objectContaining({ cache: 'no-store' }));
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
    expect(screen.getByText('Not assessable')).toBeTruthy();
    expect(screen.getByText('Priority review: older order; delivery evidence still required.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /delete|dispose/i })).toBeNull();
  });

  it('shows unavailable sources distinctly from zero', async () => {
    const user = userEvent.setup();
    const value = report();
    fetchMock.mockResolvedValueOnce(response({ success: true, report: {
      ...value, sources: value.sources.map(source => source.id === 'linked-contact'
        ? { ...source, availability: 'unavailable', records: null } : source),
    } }));
    render(<AmazonPiiInventoryView onHelp={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Run read-only inventory' }));
    await screen.findByText('Partial coverage - not a clean result');
    expect(screen.getByText('Linked customer details: Unavailable')).toBeTruthy();
  });

  it('loads next and previous pages using cursors while keeping full-result totals', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response({ success: true, report: report(0, 25) }));
    fetchMock.mockResolvedValueOnce(response({ success: true, report: report(25) }));
    fetchMock.mockResolvedValueOnce(response({ success: true, report: report(0, 25) }));
    render(<AmazonPiiInventoryView onHelp={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Run read-only inventory' }));
    await screen.findByText('Sales order #1');
    await user.click(screen.getByRole('button', { name: 'Next order page' }));
    await screen.findByText('Sales order #26');
    expect(screen.getByText('27')).toBeTruthy();
    expect(fetchMock.mock.calls[1][0]).toContain('?after=25');
    await user.click(screen.getByRole('button', { name: 'Previous order page' }));
    await screen.findByText('Sales order #1');
    expect(fetchMock.mock.calls[2][0]).toContain('?after=0');
  });

  it('clears old results on a failed refresh and permits a clean retry', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response({ success: true, report: report() }));
    fetchMock.mockResolvedValueOnce(response({ error: 'Database unavailable' }, 500));
    fetchMock.mockResolvedValueOnce(response({ success: true, report: report() }));
    render(<AmazonPiiInventoryView onHelp={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Run read-only inventory' }));
    await screen.findByText('Sales order #1');
    await user.click(screen.getByRole('button', { name: 'Run read-only inventory' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('Sales order #1')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Run read-only inventory' }));
    await screen.findByText('Sales order #1');
  });

  it('opens the report-specific Help callback', async () => {
    const help = vi.fn();
    render(<AmazonPiiInventoryView onHelp={help} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Amazon PII inventory help' }));
    expect(help).toHaveBeenCalledOnce();
  });
});
