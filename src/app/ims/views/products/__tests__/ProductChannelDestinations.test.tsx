/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductChannelDestinations, NewProductChannelChoices } from '../ProductChannelDestinations';
import { FeatureToggleProvider } from '../../../components/FeatureToggleProvider';

const destination = {
  channelInstanceId: 'shop-1', displayName: 'Retail Shopify', providerDisplayName: 'Shopify',
  enabled: true, runtimeStatus: 'active', readinessStatus: 'ready', safeError: null,
  assignmentMode: 'manual', ruleDecision: 'include', effectiveDecision: 'exclude',
  matchedRuleName: null, overrideMode: 'automatic', desiredState: 'unpublished', providerState: 'unpublished',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
let issues: string[];
let current: typeof destination;

async function open() {
  render(<ProductChannelDestinations productId="product-1" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Include in Channels' }));
  return screen.getByRole('dialog', { name: 'Include in Channels' });
}

describe('product Channels and Publishing', () => {
  beforeEach(() => {
    issues = [];
    current = { ...destination };
    window.history.replaceState({}, '', '#products');
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      if (init?.method === 'POST') return json({ success: true });
      return json({ success: true, destinations: [current], publicationIssues: issues });
    }));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('uses the new labels and previews requirements before Apply', async () => {
    issues = ['Description is required.', 'Variant 1: SKU is required.', 'Variant 1: RRP must be greater than zero.'];
    const dialog = await open();
    expect(screen.getByRole('heading', { name: 'Channels and Publishing' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Apply Rules' })).toBeTruthy();
    for (const issue of issues) expect(within(dialog).getByText(issue)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('checkbox'));
    expect(within(dialog).getByRole('button', { name: 'Apply' }).hasAttribute('disabled')).toBe(true);
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('hides rule controls when disabled but still permits manual publishing', async () => {
    render(<FeatureToggleProvider loaded settings={{ feature_toggle_channel_rules: 'no' }}>
      <ProductChannelDestinations productId="product-1" />
    </FeatureToggleProvider>);
    await userEvent.click(await screen.findByRole('button', { name: 'Include in Channels' }));
    const dialog = screen.getByRole('dialog', { name: 'Include in Channels' });
    expect(screen.queryByText('Rule recommendation')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Retail Shopify override' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Apply Rules' })).toBeNull();
    expect(within(dialog).queryByText('Not recommended')).toBeNull();
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(fetch).toHaveBeenCalledWith('/api/ims/products/channel-assignments', expect.objectContaining({
      body: JSON.stringify({ productIds: ['product-1'], channelInstanceIds: ['shop-1'], action: 'include' }),
    }));
  });

  it('does not fetch or apply channel rules for a new product when the feature is off', async () => {
    vi.mocked(fetch).mockResolvedValue(json({ success: true, instances: [current] }));
    render(<FeatureToggleProvider loaded settings={{ feature_toggle_channel_rules: 'no' }}>
      <NewProductChannelChoices context={{
        online_candidate: true, active: true, stock_item: true,
        product_type: null, category: null, subcategory: null, brand: null, tags: [],
        description: 'A product', website_title: 'Product', image_count: 0, variant_count: 1,
      }} selectedChannelIds={[]} onChange={vi.fn()} />
    </FeatureToggleProvider>);
    expect(await screen.findByRole('checkbox')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apply Rules' })).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('product-rules'))).toBe(false);
  });

  it('Apply Rules changes selections only; Apply submits publication', async () => {
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply Rules' }));
    expect(within(dialog).getByRole('checkbox').getAttribute('type')).toBe('checkbox');
    expect((within(dialog).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(fetch).toHaveBeenCalledWith('/api/ims/products/channel-assignments', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ productIds: ['product-1'], channelInstanceIds: ['shop-1'], action: 'include' }),
    }));
  });

  it('warns on Cancel, preserves selections on Return and discards them on Leave', async () => {
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('have not been applied');
    await userEvent.click(screen.getByRole('button', { name: 'Return' }));
    expect((within(dialog).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Leave without applying' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Include in Channels' }));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('does not warn when selections are unchanged or changed back', async () => {
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reloads requirements when reopened after the saved product has been corrected', async () => {
    issues = ['Description is required.'];
    let dialog = await open();
    expect(within(dialog).getByText(issues[0])).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    issues = [];
    await userEvent.click(screen.getByRole('button', { name: 'Include in Channels' }));
    dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox'));
    expect(within(dialog).queryByText('Description is required.')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Apply' }).hasAttribute('disabled')).toBe(false);
  });

  it('guards Escape, backdrop dismissal and browser reload while selections are unapplied', async () => {
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('checkbox'));
    const unload = new Event('beforeunload', { cancelable: true });
    fireEvent(window, unload);
    expect(unload.defaultPrevented).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(dialog);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('guards hash navigation and lets the user return to the current selections', async () => {
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('checkbox'));
    window.history.replaceState({}, '', '#sales-channels');
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(window.location.hash).toBe('#products');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Return' }));
    expect((within(dialog).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('allows removal even if required publication fields are missing', async () => {
    current.desiredState = 'published';
    current.providerState = 'published';
    issues = ['Description is required.'];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('checkbox'));
    expect(within(dialog).getByRole('button', { name: 'Apply' }).hasAttribute('disabled')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(fetch).toHaveBeenCalledWith('/api/ims/products/channel-assignments', expect.objectContaining({
      body: JSON.stringify({ productIds: ['product-1'], channelInstanceIds: ['shop-1'], action: 'exclude' }),
    }));
  });

  it('can retry an already included product after its required fields are corrected', async () => {
    current.desiredState = 'published';
    current.providerState = 'error';
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(fetch).toHaveBeenCalledWith('/api/ims/products/channel-assignments', expect.objectContaining({
      body: JSON.stringify({ productIds: ['product-1'], channelInstanceIds: ['shop-1'], action: 'include' }),
    }));
  });

  it('preserves selections and shows fresh validation if the server blocks Apply', async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        issues = ['Variant 1: RRP must be greater than zero.'];
        return json({ success: false, error: 'Required product fields are missing.' }, 422);
      }
      return json({ success: true, destinations: [current], publicationIssues: issues });
    });
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(await within(dialog).findByText('Required product fields are missing.')).toBeTruthy();
    expect(within(dialog).getByText(issues[0])).toBeTruthy();
    expect((within(dialog).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });
});
