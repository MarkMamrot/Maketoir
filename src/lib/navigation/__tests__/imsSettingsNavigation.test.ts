import { describe, expect, it } from 'vitest';
import { IMS_SETTINGS_MENU, resolveSettingsSection, settingsOwnedUpdates, settingsPath, visibleSettingsMenu } from '../imsSettingsNavigation';

describe('IMS settings navigation', () => {
  it('has eight groups and unique reachable leaf IDs', () => {
    expect(IMS_SETTINGS_MENU).toHaveLength(8);
    const ids: string[] = [];
    const walk = (items: typeof IMS_SETTINGS_MENU | ReturnType<typeof visibleSettingsMenu>) => {
      for (const item of items) { ids.push(item.id); if ('children' in item && item.children) walk([...item.children]); }
    };
    walk(IMS_SETTINGS_MENU);
    expect(new Set(ids).size).toBe(ids.length);
    expect(settingsPath('pos-receipts').map(item => item.label)).toEqual(['Point of Sale', 'Receipts & gift receipts']);
    expect(settingsPath('purchase-pdf')).toHaveLength(3);
  });
  it('resolves known and legacy destinations without blank panels', () => {
    expect(resolveSettingsSection('settings-pos')).toBe('pos');
    expect(resolveSettingsSection('inventory-documents')).toBe('general');
    expect(resolveSettingsSection('settings-accounts-email')).toBe('accounts-email');
    expect(resolveSettingsSection('unknown')).toBe('general');
    expect(resolveSettingsSection('business')).toBe('general');
  });
  it('keeps enabling destinations visible but hides privileged and unavailable subpages', () => {
    const ordinary = visibleSettingsMenu({ superAdmin: false, buildsEnabled: false });
    expect(settingsPath('utilities', ordinary)).toEqual([]);
    expect(settingsPath('builds', ordinary)).toEqual([]);
    expect(settingsPath('xero', ordinary)).not.toEqual([]);
    expect(settingsPath('general', ordinary)).not.toEqual([]);
    expect(settingsPath('utilities', visibleSettingsMenu({ superAdmin: true, buildsEnabled: true }))).not.toEqual([]);
  });
  it('saves only dirty fields owned by a page, including intentional clearing', () => {
    expect(settingsOwnedUpdates({ name: '', tax: '0.2', unchanged: 'x' }, { name: 'old', tax: '0.1', unchanged: 'x' }, ['name', 'unchanged']))
      .toEqual({ name: '' });
  });
});
