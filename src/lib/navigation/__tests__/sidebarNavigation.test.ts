import { describe, expect, it } from 'vitest';

import { getCollapsedSidebarAction, isSidebarSectionActive } from '../sidebarNavigation';

describe('sidebar navigation', () => {
  it('expands a collapsed group without navigating to a placeholder page', () => {
    expect(getCollapsedSidebarAction({ id: 'sales', children: [{ id: 'sales-orders' }] })).toEqual({
      openSection: 'sales',
      navigateTo: null,
    });
  });

  it('expands the sidebar and navigates when the item is a real page', () => {
    expect(getCollapsedSidebarAction({ id: 'dashboard', children: [] })).toEqual({
      openSection: null,
      navigateTo: 'dashboard',
    });
  });

  it('marks groups active for children and detail-view aliases', () => {
    const contacts = { id: 'contacts', children: [{ id: 'crm' }] };
    expect(isSidebarSectionActive(contacts, 'crm')).toBe(true);
    expect(isSidebarSectionActive(contacts, 'contact-profile', ['contact-profile'])).toBe(true);
    expect(isSidebarSectionActive(contacts, 'reports')).toBe(false);
  });

  it('marks Automations active for nested marketing and business-profile pages, not report pages', () => {
    const automations = {
      id: '__automation',
      children: [
        { id: '__marketing', children: [{ id: 'planning-workspace' }] },
        { id: '__business-profile', children: [{ id: 'brand-profile' }] },
      ],
    };
    expect(isSidebarSectionActive(automations, 'planning-workspace')).toBe(true);
    expect(isSidebarSectionActive(automations, 'brand-profile')).toBe(true);
    expect(isSidebarSectionActive(automations, 'stock-turnover')).toBe(false);
  });
});