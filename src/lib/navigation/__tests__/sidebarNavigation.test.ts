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
});