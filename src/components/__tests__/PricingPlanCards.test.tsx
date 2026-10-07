// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PricingPlanCards, { pricingComparisonSections, pricingPlans } from '../PricingPlanCards';

afterEach(cleanup);

describe('published pricing plans', () => {
  it('publishes Growth between Starter and Core with the approved terms', () => {
    expect(pricingPlans.map(plan => plan.id)).toEqual(['starter', 'growth', 'core', 'scale', 'enterprise']);
    expect(pricingPlans.find(plan => plan.id === 'growth')).toMatchObject({
      price: 'From $159', secondaryPrice: '$199/month without Connected Payments',
      pricingNote: 'Monthly. With eligible Connected Payments volume. Excludes GST.',
      summaryFeatures: [
        'Annual turnover up to A$2 million', '1 location, 2 registers and up to 10 users',
        'Complete operational feature set', 'Native online shop and wholesale portal',
        'AI Automation with preferred credit rates', '3 standard integrations', 'Self onboarding and local helpdesk',
      ],
    });
    expect(pricingPlans.find(plan => plan.id === 'core')?.summaryFeatures).toContain('5 standard integrations');
  });

  it('defines every comparison value and removes order allowances', () => {
    const features = pricingComparisonSections.flatMap(section => section.features);
    for (const feature of features) expect(Object.keys(feature.values)).toEqual(pricingPlans.map(plan => plan.id));
    expect(features.some(feature => /order allowance|order capacity/i.test(feature.label))).toBe(false);
    expect(features.find(feature => feature.label === 'Standard integrations included')?.values).toMatchObject({ growth: '3', core: '5' });
    expect(features.find(feature => feature.label === 'Custom online-shop domain')?.values.growth).toBe(false);
    expect(features.find(feature => feature.label === 'Wholesale ordering portal')?.values.growth).toBe(true);
    expect(features.find(feature => feature.label === 'Team users included')?.values.growth).toBe('10');
  });

  it('opens the Growth comparison with all five columns', () => {
    render(<PricingPlanCards onContactSales={vi.fn()} />);
    const growthCard = screen.getByRole('heading', { name: 'Growth', exact: true }).closest('article')!;
    expect(within(growthCard).getByText('From $159')).toBeTruthy();
    fireEvent.click(within(growthCard).getByRole('button', { name: 'Compare full feature list' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('The Growth column is highlighted.')).toBeTruthy();
    expect(dialog.querySelectorAll('thead th')).toHaveLength(6);
    expect(dialog.querySelector('tbody th[colspan]')?.getAttribute('colspan')).toBe('6');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});