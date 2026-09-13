/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InventoryCostingSettings } from '../InventoryCostingSettings';

const averageToFifo = {
  currentMethod: 'average_cost',
  targetMethod: 'fifo',
  revision: 1,
  stockRowCount: 1,
  positiveStockRowCount: 1,
  totalQuantity: 5,
  totalValue: 50,
  blockers: [],
  warnings: ['Future movements only.'],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('InventoryCostingSettings', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows a loading state until the preview is available', async () => {
    let resolveFetch!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise(resolve => { resolveFetch = resolve; }));

    render(React.createElement(InventoryCostingSettings));
    expect(screen.getByText('Loading costing position...')).toBeTruthy();

    resolveFetch(jsonResponse({ success: true, preview: averageToFifo }));
    expect(await screen.findByRole('button', { name: 'Switch to FIFO' })).toBeTruthy();
    expect(screen.queryByText('Loading costing position...')).toBeNull();
  });

  it('shows authorization failures without rendering stale controls', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'Administrator access is required.' }, 403));

    render(React.createElement(InventoryCostingSettings));

    expect((await screen.findByRole('alert')).textContent).toContain('Administrator access is required.');
    expect(screen.queryByRole('button', { name: 'Switch to FIFO' })).toBeNull();
  });

  it('blocks duplicate submissions and resets confirmation fields after success', async () => {
    let resolvePost!: (response: Response) => void;
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ success: true, preview: averageToFifo }))
      .mockReturnValueOnce(new Promise(resolve => { resolvePost = resolve; }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        preview: { ...averageToFifo, currentMethod: 'fifo', targetMethod: 'average_cost', revision: 2 },
      }));
    const user = userEvent.setup();
    render(React.createElement(InventoryCostingSettings));

    const reason = await screen.findByRole('textbox', { name: 'Reason' });
    const confirmation = screen.getByRole('textbox', { name: 'Type FIFO to confirm' });
    await user.type(reason, 'Adopt FIFO policy');
    await user.type(confirmation, 'FIFO');
    const button = screen.getByRole('button', { name: 'Switch to FIFO' });
    await user.dblClick(button);

    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'Switching...' }) as HTMLButtonElement).disabled).toBe(true);

    resolvePost(jsonResponse({ success: true, epochId: 4 }));
    expect(await screen.findByRole('button', { name: 'Switch to Average Cost' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Reason' }) as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByRole('textbox', { name: 'Type AVERAGE COST to confirm' }) as HTMLInputElement).value).toBe('');
  });

  it('surfaces a stale revision conflict and preserves the operator input', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ success: true, preview: averageToFifo }))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'Inventory costing changed after this preview.' }, 409));
    const user = userEvent.setup();
    render(React.createElement(InventoryCostingSettings));

    const reason = await screen.findByRole('textbox', { name: 'Reason' });
    const confirmation = screen.getByRole('textbox', { name: 'Type FIFO to confirm' });
    await user.type(reason, 'Adopt FIFO policy');
    await user.type(confirmation, 'FIFO');
    await user.click(screen.getByRole('button', { name: 'Switch to FIFO' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Inventory costing changed after this preview.');
    expect((reason as HTMLTextAreaElement).value).toBe('Adopt FIFO policy');
    expect((confirmation as HTMLInputElement).value).toBe('FIFO');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Switch to FIFO' }) as HTMLButtonElement).disabled).toBe(false));
  });
});
