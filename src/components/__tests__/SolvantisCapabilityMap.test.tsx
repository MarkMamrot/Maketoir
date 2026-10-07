// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SolvantisCapabilityMap from '../SolvantisCapabilityMap';

vi.mock('next/image', () => ({ default: ({ fill, priority, ...props }: any) => <img {...props} /> }));
afterEach(cleanup);

describe('landing map variants', () => {
  it('preserves the original combined CRM and Loyalty details', () => {
    render(<SolvantisCapabilityMap />);
    fireEvent.click(screen.getByRole('button', { name: 'Explore Loyalty features' }));
    expect(screen.getByRole('heading', { name: 'CRM and Loyalty' })).toBeTruthy();
  });

  it('separates loyalty and CRM in the preview', () => {
    render(<SolvantisCapabilityMap refreshed />);
    expect(document.querySelectorAll('.group.absolute')).toHaveLength(10);
    expect(document.querySelectorAll('.grid.grid-cols-2 button')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'Explore Loyalty features' }));
    expect(screen.getByRole('heading', { name: 'Loyalty and Store Credit' })).toBeTruthy();
    expect(screen.getByRole('dialog').className).toContain('z-[12110]');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Explore CRM features' }));
    expect(screen.getByRole('heading', { name: 'Customer Relationships' })).toBeTruthy();
  });

  it('describes multiple storefronts and qualified Amazon support', () => {
    render(<SolvantisCapabilityMap refreshed />);
    fireEvent.click(screen.getByRole('button', { name: 'Explore Multi Channel Commerce features' }));
    expect(screen.getByText('Multiple Shopify stores with separate connections and settings')).toBeTruthy();
    expect(screen.getByText(/existing-ASIN offers, subject to readiness/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'More about Multi Channel' }).getAttribute('href')).toBe('#sales-channels');
  });

  it('links to the detailed landing sections when embedded on the original page', () => {
    render(<SolvantisCapabilityMap refreshed sectionBasePath="/landing2.html" />);
    fireEvent.click(screen.getByRole('button', { name: 'Explore Multi Channel Commerce features' }));
    expect(screen.getByRole('link', { name: 'More about Multi Channel' }).getAttribute('href')).toBe('/landing2.html#sales-channels');
  });

  it('keeps preview focus within details and returns it on Escape', async () => {
    render(<SolvantisCapabilityMap refreshed />);
    const trigger = screen.getByRole('button', { name: 'Explore Point of Sale features' });
    fireEvent.click(trigger);
    const close = screen.getByRole('button', { name: 'Close capability details' });
    await waitFor(() => expect(document.activeElement).toBe(close));
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'More about POS' }));
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});