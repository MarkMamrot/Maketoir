// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UnifiedHelpDrawer } from '../UnifiedHelpDrawer';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('UnifiedHelpDrawer layered topics', () => {
  it('submits pasted and selected images and allows removal', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
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
