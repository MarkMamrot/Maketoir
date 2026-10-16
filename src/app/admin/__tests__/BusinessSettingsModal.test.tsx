/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessSettingsModal } from '../BusinessSettingsModal';

const biz = {
  business_id: 'business-1', name: 'Test business', has_foresight: 1, has_ims: 1, has_pos: 1,
  is_sandbox: 0, automation_paused: 0, max_locations: 2, max_users: 10, cost_per_location: 149,
};
const account = {
  planKey: 'core', fundingMode: 'prepaid', enforcementMode: 'observe',
  cycleMode: 'calendar_month', cycleAnchorDay: 1, cycleTimezone: 'Australia/Sydney', limitAud: '100.00', warningPercent: 80,
};
const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const closeModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function renderModal() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<BusinessSettingsModal biz={biz} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
}
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterAll(() => {
  if (showModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (closeModal) Object.defineProperty(HTMLDialogElement.prototype, 'close', closeModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/ai-billing/')) return json({ account });
    if (url.endsWith('/billing')) return json({ success: true, billing: { planStartDate: null, entries: [] } });
    if (init?.method === 'PATCH') return json({ success: true });
    throw new Error(`Unexpected request: ${url}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('tabbed Business Settings', () => {
  it('keeps actions outside the scrolling tab panel and separates billing from General', async () => {
    const user = userEvent.setup();
    renderModal();
    const save = await screen.findByRole('button', { name: 'Save Changes' });
    await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false));
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['General', 'Plan & Billing', 'History']);
    expect(screen.queryByLabelText('Plan start date')).toBeNull();
    expect(within(screen.getByRole('tabpanel')).queryByRole('button', { name: 'Save Changes' })).toBeNull();
    expect(save.closest('footer')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Plan & Billing' }));
    expect(screen.getByLabelText('Plan start date')).toBeTruthy();
    expect(screen.getByLabelText('Solvantis AI plan')).toBeTruthy();
    expect(screen.queryByLabelText('Business name')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBe(save);
  });
  it('preserves drafts across tabs and supports arrow-key tab navigation', async () => {
    const user = userEvent.setup();
    renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' }).hasAttribute('disabled')).toBe(false));
    await user.clear(screen.getByLabelText('Business name'));
    await user.type(screen.getByLabelText('Business name'), 'Updated business');
    screen.getByRole('tab', { name: 'General' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Plan & Billing' }).getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Home}');
    expect((screen.getByLabelText('Business name') as HTMLInputElement).value).toBe('Updated business');
  });
  it('lists unrecorded months by selectable year without fabricating payment amounts', async () => {
    vi.mocked(fetch).mockImplementation(async url => String(url).includes('/ai-billing/')
      ? json({ account }) : json({ success: true, billing: { planStartDate: '2025-12-15', entries: [] } }));
    const user = userEvent.setup();
    renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' }).hasAttribute('disabled')).toBe(false));
    await user.click(screen.getByRole('tab', { name: 'History' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'History year' }), '2025');
    expect(screen.getByText('December 2025')).toBeTruthy();
    expect(screen.getByText('Not recorded')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Amount for December 2025' }) as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('checkbox', { name: 'Paid for December 2025' }) as HTMLInputElement).checked).toBe(false);
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });
  it('saves the start date, monthly plan, exact amount and manual paid status', async () => {
    const user = userEvent.setup();
    const { onSaved, onClose } = renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' }).hasAttribute('disabled')).toBe(false));
    await user.click(screen.getByRole('tab', { name: 'Plan & Billing' }));
    fireEvent.change(screen.getByLabelText('Plan start date'), { target: { value: '2025-12-15' } });
    await user.click(screen.getByRole('tab', { name: 'History' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'History year' }), '2025');
    await user.type(screen.getByRole('textbox', { name: 'Payment plan for December 2025' }), 'Core monthly');
    await user.type(screen.getByRole('textbox', { name: 'Amount for December 2025' }), '149.50');
    await user.click(screen.getByRole('checkbox', { name: 'Paid for December 2025' }));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
    const request = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith('/billing') && init?.method === 'PATCH');
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      planStartDate: '2025-12-15', expectedPlanStartDate: null,
      entries: [{ month: '2025-12', paymentPlan: 'Core monthly', amountAud: '149.50', paid: true, revision: 0 }],
    });
  });
  it('validates incomplete monthly records before any settings are saved', async () => {
    vi.mocked(fetch).mockImplementation(async url => String(url).includes('/ai-billing/')
      ? json({ account }) : json({ success: true, billing: { planStartDate: '2025-12-15', entries: [] } }));
    const user = userEvent.setup();
    renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' }).hasAttribute('disabled')).toBe(false));
    await user.click(screen.getByRole('tab', { name: 'History' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'History year' }), '2025');
    await user.click(screen.getByRole('checkbox', { name: 'Paid for December 2025' }));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect((await screen.findByRole('alert')).textContent).toContain('enter a payment plan');
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method !== 'PATCH')).toBe(true);
  });
  it('shows load failures and permits an explicit retry without enabling Save', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ account }))
      .mockResolvedValueOnce(json({ error: 'Billing unavailable' }, 500));
    const user = userEvent.setup();
    renderModal();
    expect((await screen.findByRole('alert')).textContent).toBe('Billing unavailable');
    expect(screen.getByRole('button', { name: 'Save Changes' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Retry loading' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' }).hasAttribute('disabled')).toBe(false));
  });
  it('reports partial-save failures without closing or losing billing drafts', async () => {
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).includes('/ai-billing/')) return json({ account });
      if (String(url).endsWith('/billing')) return init?.method === 'PATCH'
        ? json({ error: 'Billing save failed' }, 500) : json({ success: true, billing: { planStartDate: null, entries: [] } });
      return json({ success: true });
    });
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' }).hasAttribute('disabled')).toBe(false));
    await user.click(screen.getByRole('tab', { name: 'Plan & Billing' }));
    fireEvent.change(screen.getByLabelText('Plan start date'), { target: { value: '2026-01-01' } });
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Business details and limits saved. Remaining changes were not confirmed. Billing save failed');
    expect((screen.getByLabelText('Plan start date') as HTMLInputElement).value).toBe('2026-01-01');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save Changes' }).hasAttribute('disabled')).toBe(false);
  });
  it('keeps existing AI funding and enforcement when changing the AI plan', async () => {
    const user = userEvent.setup();
    renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' }).hasAttribute('disabled')).toBe(false));
    await user.click(screen.getByRole('tab', { name: 'Plan & Billing' }));
    await user.selectOptions(screen.getByLabelText('Solvantis AI plan'), 'scale');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).includes('/ai-billing/') && init?.method === 'PATCH')).toBe(true));
    const request = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).includes('/ai-billing/') && init?.method === 'PATCH');
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ ...account, planKey: 'scale', command: 'configure' });
  });
  it('asks before discarding drafts when Cancel or Escape is used', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' }).hasAttribute('disabled')).toBe(false));
    await user.type(screen.getByLabelText('Business name'), ' edited');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith('Discard unsaved Business Settings changes?');
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
