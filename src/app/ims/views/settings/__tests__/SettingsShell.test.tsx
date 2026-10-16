/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMS_SETTINGS_MENU } from '@/lib/navigation/imsSettingsNavigation';
import { SettingsActions, SettingsShell, useSettingsDirty } from '../SettingsShell';

beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
  window.history.replaceState({}, '', '#settings-general');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Draft({ dirty }: { dirty: boolean }) {
  useSettingsDirty(dirty);
  return <input aria-label="Draft" />;
}
function shell(dirty = false) {
  const onNavigate = vi.fn(), onClose = vi.fn();
  render(<SettingsShell active="general" items={IMS_SETTINGS_MENU} businessName="Sandbox" onNavigate={onNavigate}
    onClose={onClose} onHelp={vi.fn()}><Draft dirty={dirty} /></SettingsShell>);
  return { onNavigate, onClose };
}

describe('settings tree and draft protection', () => {
  it('groups actions without changing click handlers, disabled states or feedback', async () => {
    const user = userEvent.setup();
    const save = vi.fn(), cancel = vi.fn();
    render(<SettingsActions>
      <button type="button" data-primary disabled onClick={save}>Save permissions</button>
      <button type="button" onClick={cancel}>Cancel</button>
      <p role="alert">Settings could not be saved.</p>
    </SettingsActions>);
    const saveButton = screen.getByRole('button', { name: 'Save permissions' });
    const actions = saveButton.closest('[data-settings-actions]');
    expect(actions).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' }).parentElement).toBe(actions);
    expect(screen.getByRole('alert').parentElement).toBe(actions);
    await user.click(saveButton);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(save).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('expands ancestors and exposes the current page', async () => {
    const user = userEvent.setup();
    const { onNavigate } = shell();
    expect(screen.getByRole('button', { name: 'Business operations' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('navigation', { name: 'Settings' }).querySelectorAll('button:not(.sv-button-flat)').length).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Purchasing' }));
    await user.click(screen.getByRole('button', { name: 'Purchase order documents' }));
    await user.click(screen.getByRole('button', { name: 'Email template' }));
    expect(onNavigate).toHaveBeenCalledWith('purchase-orders');
  });
  it('keeps edits or explicitly discards them before selecting another leaf', async () => {
    const user = userEvent.setup();
    const { onNavigate } = shell(true);
    await user.click(screen.getByRole('button', { name: /^Users$/ }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(onNavigate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Users$/ }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onNavigate).toHaveBeenCalledWith('users');
  });
  it('warns on close and lets Escape dismiss the discard dialog without closing settings', async () => {
    const user = userEvent.setup();
    const { onClose } = shell(true);
    await user.click(screen.getByRole('button', { name: 'Close settings' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close settings' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('blocks browser hash changes until the user resolves the draft', () => {
    shell(true);
    window.history.replaceState({}, '', '#settings-users');
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(window.location.hash).toBe('#settings-general');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
  it('dismisses the mobile navigation with Escape before closing settings', async () => {
    const user = userEvent.setup();
    const { onClose } = shell();
    const menu = screen.getByRole('button', { name: 'Settings navigation' });
    await user.click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Escape}');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(menu);
  });
  it('restores the opener focus after closing', () => {
    const opener = document.createElement('button');
    document.body.append(opener); opener.focus();
    shell(); cleanup();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
