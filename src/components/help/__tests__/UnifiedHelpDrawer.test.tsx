// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UnifiedHelpDrawer } from '../UnifiedHelpDrawer';

afterEach(cleanup);

describe('UnifiedHelpDrawer layered topics', () => {
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
