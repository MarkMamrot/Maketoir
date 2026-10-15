/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LaybyFeeSettings } from '../LaybyFeeSettings';

const locations = [{ id: 1, name: 'First branch' }, { id: 2, name: 'Second branch' }];
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('branch layby fee drafts', () => {
  it('keeps fee editing unavailable after a failed load', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Load failed' }), { status: 500 }));
    render(<LaybyFeeSettings locations={locations} />);
    await screen.findByText('Load failed');
    expect(screen.getByRole('spinbutton').hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /^Save$/ }).hasAttribute('disabled')).toBe(true);
  });
  it('cancels a draft and locks the branch and percentage while saving', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ settings: { laybyCancellationFeePercent: 5 } })))
      .mockReturnValueOnce(new Promise<Response>(() => {}));
    const user = userEvent.setup();
    render(<LaybyFeeSettings locations={locations} />);
    const fee = screen.getByRole('spinbutton');
    await waitFor(() => expect((fee as HTMLInputElement).value).toBe('5'));
    await user.clear(fee); await user.type(fee, '8');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((fee as HTMLInputElement).value).toBe('5');
    await user.clear(fee); await user.type(fee, '7');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(true);
    expect(fee.hasAttribute('disabled')).toBe(true);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({ location_id: 1, laybyCancellationFeePercent: 7 });
  });
});
