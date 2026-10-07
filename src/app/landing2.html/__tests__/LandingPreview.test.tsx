// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LandingPreview from '../LandingPreview';
import Landing from '@/app/_landing';

vi.mock('next/image', () => ({ default: ({ fill, priority, ...props }: any) => <img {...props} /> }));
vi.mock('@/components/SolvantisCapabilityMap', () => ({ default: ({ refreshed, sectionBasePath = '' }: { refreshed: boolean; sectionBasePath?: string }) => <div data-testid="map" data-section-base={sectionBasePath}>{refreshed ? 'Preview map' : 'Original map'}</div> }));
vi.mock('@/components/assistant/ProspectSalesAssistant', () => ({ ProspectSalesAssistant: ({ sourcePath }: { sourcePath: string }) => <div data-testid="assistant">{sourcePath}</div> }));
vi.mock('@/components/assistant/ProspectLeadForm', () => ({ ProspectLeadDialog: ({ open, sourcePath, onClose }: any) => open ? <div role="dialog" aria-label="Sales"><span>{sourcePath}</span><button onClick={onClose}>Close sales</button></div> : null }));
afterEach(cleanup);

describe('separate landing preview', () => {
  it('shares identical pricing and refreshed feature content with the original landing', () => {
    render(<Landing />);
    const originalPricing = Array.from(document.querySelectorAll('#pricing article')).map(card => card.textContent);
    expect(originalPricing).toHaveLength(5);
    expect(screen.getByTestId('map').textContent).toBe('Preview map');
    expect(screen.getByTestId('map').getAttribute('data-section-base')).toBe('/landing2.html');
    cleanup();
    render(<LandingPreview />);
    expect(Array.from(document.querySelectorAll('#pricing article')).map(card => card.textContent)).toEqual(originalPricing);
    expect(screen.getByTestId('map').textContent).toBe('Preview map');
  });

  it('keeps uptime, uses the preview map and links to real sections', () => {
    render(<LandingPreview />);
    expect(screen.getByText('99.9%').className).toBe('text-4xl font-black text-blue-600');
    expect(screen.getByText('Platform Uptime')).toBeTruthy();
    expect(screen.getByTestId('map').textContent).toBe('Preview map');
    expect(screen.getByTestId('assistant').textContent).toBe('/landing2.html');
    for (const id of ['inventory', 'pos', 'daybooks', 'wholesale', 'sales-channels', 'integrations', 'pricing']) expect(document.getElementById(id)).toBeTruthy();
    for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))) expect(document.getElementById(link.hash.slice(1))).toBeTruthy();
    expect(screen.queryByText(/Start Free Trial|No manual data entry, ever|Full offline mode/)).toBeNull();
  });

  it('opens demo requests and closes the mobile menu on navigation', () => {
    render(<LandingPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(document.querySelector('#preview-menu a[href="#daybooks"]')!);
    expect(document.getElementById('preview-menu')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Book a Demo' })[0]);
    expect(screen.getByRole('dialog', { name: 'Sales' })).toBeTruthy();
  });

  it('opens an existing video and closes it with Escape', () => {
    render(<LandingPreview />);
    const trigger = screen.getByRole('button', { name: 'Play Invoice to Purchase Order walkthrough' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Invoice to Purchase Order' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});