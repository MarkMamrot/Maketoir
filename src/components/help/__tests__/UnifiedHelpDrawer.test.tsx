// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UnifiedHelpDrawer } from '../UnifiedHelpDrawer';

vi.mock('@/components/assistant/SolvantisAssistantPanel', () => ({
  SolvantisAssistantPanel: ({ onCitationOpen }: { onCitationOpen: (citation: { topicId: string; sectionId?: string }) => void }) => (
    <div>
      <button onClick={() => onCitationOpen({ topicId: 'pos-register-device-login' })}>POS citation</button>
      <button onClick={() => onCitationOpen({ topicId: 'pos-end-of-day' })}>EOD citation</button>
      <button onClick={() => onCitationOpen({ topicId: 'pos-end-of-day-xero' })}>EOD accounting citation</button>
      <button onClick={() => onCitationOpen({ topicId: 'setup-cron-jobs' })}>Platform citation</button>
      <button onClick={() => onCitationOpen({ topicId: 'ims-workspaces', sectionId: 'missing-section' })}>Invalid section citation</button>
    </div>
  ),
}));

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

const helpProps = {
  open: true,
  onOpenChange: vi.fn(),
  audience: 'ims' as const,
  product: 'ims' as const,
  currentContext: 'dashboard',
  chatEndpoint: '/assistant',
  escalationEndpoint: '/escalate',
  showFloatingTrigger: false,
};

describe('UnifiedHelpDrawer layered topics', () => {
  it.each([true, false])('keeps register close guidance available with accounting enabled=%s', xero => {
    render(<UnifiedHelpDrawer {...helpProps} audience="pos" product="pos" currentContext="eod" availableCapabilities={{ xero }} />);
    expect(screen.getByRole('heading', { name: 'End of Day and Register Close', level: 1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Step-by-step', expanded: true })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Help topics' });
    expect(within(nav).getByRole('button', { name: 'Close the register and reconcile takings' })).toBeTruthy();
    expect(Boolean(within(nav).queryByRole('button', { name: 'Review EOD accounting and retry Xero posting' }))).toBe(xero);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search Help' }), { target: { value: 'Save EOD Reconciliation' } });
    expect(within(nav).getByRole('button', { name: 'POS > Start & end of day > End of Day and Register Close > Step-by-step', exact: true })).toBeTruthy();
  });

  it('opens operational EOD related links and citations without allowing accounting citations', () => {
    render(<UnifiedHelpDrawer {...helpProps} audience="pos" product="pos" currentContext="pos-register" availableCapabilities={{ xero: false }} />);
    const related = screen.getByRole('navigation', { name: 'Related Help topics' });
    fireEvent.click(within(related).getByRole('button', { name: 'End of Day and Register Close' }));
    expect(screen.getByRole('heading', { name: 'End of Day and Register Close', level: 1 })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Ask Solvantis' }));
    fireEvent.click(screen.getByRole('button', { name: 'EOD citation' }));
    expect(screen.getByRole('heading', { name: 'End of Day and Register Close', level: 1 })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Ask Solvantis' }));
    fireEvent.click(screen.getByRole('button', { name: 'EOD accounting citation' }));
    expect(screen.getByRole('status').textContent).toContain('not available');
    expect(screen.queryByRole('heading', { name: 'POS End of Day and Xero', level: 1 })).toBeNull();
  });

  it('returns from accounting to operational EOD guidance when accounting availability changes', () => {
    const props = { ...helpProps, audience: 'pos' as const, product: 'pos' as const, currentContext: 'eod' };
    const { rerender } = render(<UnifiedHelpDrawer {...props} availableCapabilities={{ xero: true }} />);
    const nav = screen.getByRole('navigation', { name: 'Help topics' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Review EOD accounting and retry Xero posting' }));
    expect(screen.getByRole('heading', { name: 'POS End of Day and Xero', level: 1 })).toBeTruthy();
    rerender(<UnifiedHelpDrawer {...props} availableCapabilities={{ xero: false }} />);
    expect(screen.getByRole('heading', { name: 'End of Day and Register Close', level: 1 })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'POS End of Day and Xero', level: 1 })).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'Review EOD accounting and retry Xero posting' })).toBeNull();
  });

  it('opens only the contextual category and gives nested disclosure controls valid targets', () => {
    render(<UnifiedHelpDrawer {...helpProps} currentContext="sales-orders" />);
    const nav = screen.getByRole('navigation', { name: 'Help topics' });
    expect(within(nav).getByRole('button', { name: 'Sales', expanded: true })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Products', expanded: false })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Create and fulfil sales orders' }).getAttribute('aria-current')).toBe('page');
    for (const button of within(nav).getAllByRole('button').filter(item => item.hasAttribute('aria-controls'))) {
      expect(document.getElementById(button.getAttribute('aria-controls')!)).toBeTruthy();
    }
  });

  it('opens a buried workflow section and marks its shortcut selected', async () => {
    render(<UnifiedHelpDrawer {...helpProps} />);
    const nav = screen.getByRole('navigation', { name: 'Help topics' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Products', expanded: false }));
    fireEvent.click(within(nav).getByRole('button', { name: 'Manage brands' }));
    expect(screen.getByRole('heading', { name: 'Catalogue and Stock', level: 1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Brands', expanded: true })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Manage brands' }).getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'start' }));
  });

  it('browses POS workflows from IMS and returns to contextual guidance', () => {
    render(<UnifiedHelpDrawer {...helpProps} />);
    const nav = screen.getByRole('navigation', { name: 'Help topics' });
    fireEvent.click(within(nav).getByRole('button', { name: 'POS', expanded: false }));
    fireEvent.click(within(nav).getByRole('button', { name: 'Start & end of day', expanded: false }));
    fireEvent.click(within(nav).getByRole('button', { name: 'Set up a register and start the day' }));
    expect(screen.getByRole('heading', { name: 'Register, Device, and Login', level: 1 })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to help for this page' }));
    expect(screen.getByRole('heading', { name: 'IMS Workspaces', level: 1 })).toBeTruthy();
  });

  it('searches workflow labels, opens their section and restores the selected tree path', () => {
    render(<UnifiedHelpDrawer {...helpProps} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search Help' }), { target: { value: 'bulk-add or edit products' } });
    const nav = screen.getByRole('navigation', { name: 'Help topics' });
    fireEvent.click(within(nav).getByRole('button', { name: /Products > Catalogue and Stock > Bulk Add\/Edit/ }));
    expect((screen.getByRole('textbox', { name: 'Search Help' }) as HTMLInputElement).value).toBe('');
    expect(within(nav).getByRole('button', { name: 'Products', expanded: true })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Bulk-add or edit products' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Bulk Add/Edit', expanded: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Browse topics/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('follows an available cross-product related topic and resets article scrolling', async () => {
    render(<UnifiedHelpDrawer {...helpProps} currentContext="settings-pos" />);
    const article = screen.getByRole('article');
    article.scrollTop = 500;
    const related = screen.getByRole('navigation', { name: 'Related Help topics' });
    fireEvent.click(within(related).getByRole('button', { name: 'Register, Device, and Login' }));
    expect(screen.getByRole('heading', { name: 'Register, Device, and Login', level: 1 })).toBeTruthy();
    await waitFor(() => expect(article.scrollTop).toBe(0));
    const nav = screen.getByRole('navigation', { name: 'Help topics' });
    expect(within(nav).getByRole('button', { name: 'POS', expanded: true })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Start & end of day', expanded: true })).toBeTruthy();
  });

  it('removes a selected platform topic immediately when SuperAdmin access is lost', () => {
    const { rerender } = render(<UnifiedHelpDrawer {...helpProps} userTier="SuperAdmin" />);
    fireEvent.click(screen.getByRole('button', { name: 'Platform administration', expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Manage scheduled jobs' }));
    expect(screen.getByRole('heading', { name: 'Cron Jobs', level: 1 })).toBeTruthy();
    rerender(<UnifiedHelpDrawer {...helpProps} userTier="Admin" />);
    expect(screen.queryByRole('button', { name: 'Platform administration' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Cron Jobs', level: 1 })).toBeNull();
    expect(screen.getByRole('heading', { name: 'IMS Workspaces', level: 1 })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search Help' }), { target: { value: 'scheduled jobs' } });
    expect(screen.queryByRole('button', { name: /Cron Jobs/ })).toBeNull();
  });

  it('opens a permitted citation and reveals its POS workflow ancestors', () => {
    render(<UnifiedHelpDrawer {...helpProps} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Ask Solvantis' }));
    fireEvent.click(screen.getByRole('button', { name: 'POS citation' }));
    expect(screen.getByRole('heading', { name: 'Register, Device, and Login', level: 1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'POS', expanded: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start & end of day', expanded: true })).toBeTruthy();
  });

  it('denies restricted and invalid citation destinations with a visible explanation', () => {
    render(<UnifiedHelpDrawer {...helpProps} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Ask Solvantis' }));
    fireEvent.click(screen.getByRole('button', { name: 'Platform citation' }));
    expect(screen.getByRole('status').textContent).toContain('not available');
    expect(screen.queryByRole('heading', { name: 'Cron Jobs', level: 1 })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Invalid section citation' }));
    expect(screen.getByRole('status').textContent).toContain('not available');
    expect(screen.getByRole('tab', { name: 'Ask Solvantis' }).getAttribute('aria-selected')).toBe('true');
  });

  it('allows a platform citation for a SuperAdmin', () => {
    render(<UnifiedHelpDrawer {...helpProps} userTier="SuperAdmin" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Ask Solvantis' }));
    fireEvent.click(screen.getByRole('button', { name: 'Platform citation' }));
    expect(screen.getByRole('heading', { name: 'Cron Jobs', level: 1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Platform administration', expanded: true })).toBeTruthy();
  });

  it('uses unique control IDs when multiple Help drawers are mounted', () => {
    render(<><UnifiedHelpDrawer {...helpProps} /><UnifiedHelpDrawer {...helpProps} open={false} /></>);
    const ids = Array.from(document.querySelectorAll('[id]')).map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('requires and submits the POS staff reply email', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 42 }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<UnifiedHelpDrawer open onOpenChange={vi.fn()} audience="pos" product="pos" chatEndpoint="/assistant" escalationEndpoint="/escalate" supportEndpoint="/api/pos/support-tickets" showFloatingTrigger={false} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Contact Support' }));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Issue' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Details' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit ticket' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('email address');
    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'staff@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit ticket' }));
    await waitFor(() => expect(screen.getByText('Ticket submitted')).toBeTruthy());
    expect((fetchMock.mock.calls[0][1].body as FormData).get('replyEmail')).toBe('staff@example.com');
  });
  it('submits pasted and selected images and allows removal', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 42 }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<UnifiedHelpDrawer open onOpenChange={vi.fn()} audience="ims" product="ims" chatEndpoint="/assistant" escalationEndpoint="/escalate" supportEndpoint="/api/ims/support-tickets" showFloatingTrigger={false} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Contact Support' }));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Screenshot error' } });
    const description = screen.getByLabelText('Description');
    fireEvent.change(description, { target: { value: 'Existing text' } });
    const pasted = new File(['png'], 'pasted.png', { type: 'image/png' });
    fireEvent.paste(description, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => pasted }], getData: () => '' } });
    expect((description as HTMLTextAreaElement).value).toBe('Existing text');
    expect(screen.getByRole('img', { name: 'pasted.png' })).toBeTruthy();
    const picked = new File(['jpg'], 'picked.jpg', { type: 'image/jpeg' });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [picked] } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove pasted.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit ticket' }));
    await waitFor(() => expect(screen.getByText('Ticket submitted')).toBeTruthy());
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('description')).toBe('Existing text');
    expect((form.getAll('images')[0] as File).name).toBe('picked.jpg');
    expect(form.getAll('images')).toHaveLength(1);
  });

  it('shows quick guidance and expands detailed sections on demand', () => {
    render(
      <UnifiedHelpDrawer
        open
        onOpenChange={vi.fn()}
        audience="ims"
        product="ims"
        currentContext="dashboard"
        chatEndpoint="/assistant"
        escalationEndpoint="/escalate"
        showFloatingTrigger={false}
      />,
    );

    expect(screen.getByRole('heading', { name: 'IMS Workspaces', level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Main operations', level: 2 })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Browse topics/ }).className).toContain('sv-button-flat');

    const detailToggle = screen.getByRole('button', { name: 'How summaries work', expanded: false });
    expect(detailToggle.className).toContain('sv-button-flat');
    expect(screen.queryByText(/Dashboard cards, CRM profiles/)).toBeNull();

    fireEvent.click(detailToggle);

    expect(screen.getByRole('button', { name: 'How summaries work', expanded: true })).toBeTruthy();
    expect(screen.getByText(/Dashboard cards, CRM profiles/)).toBeTruthy();
  });

  it('expands a detailed section from the topic jump list', () => {
    render(
      <UnifiedHelpDrawer
        open
        onOpenChange={vi.fn()}
        audience="ims"
        product="ims"
        currentContext="dashboard"
        chatEndpoint="/assistant"
        escalationEndpoint="/escalate"
        showFloatingTrigger={false}
      />,
    );

    const matchingButtons = screen.getAllByRole('button', { name: 'How summaries work' });
    fireEvent.click(matchingButtons.find(button => !button.hasAttribute('aria-expanded'))!);

    expect(screen.getByRole('button', { name: 'How summaries work', expanded: true })).toBeTruthy();
  });
});
