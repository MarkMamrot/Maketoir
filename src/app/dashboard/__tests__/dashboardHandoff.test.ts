import { describe, expect, it } from 'vitest';
import { buildDashboardHash, dashboardHashParam, dashboardHashView } from '../dashboardHandoff';

describe('dashboardHandoff', () => {
  it('keeps dashboard view routing separate from handoff parameters', () => {
    const hash = '#planning-workspace?thread=12&recommendation=42';
    expect(dashboardHashView(hash)).toBe('planning-workspace');
    expect(dashboardHashParam(hash, 'thread')).toBe('12');
    expect(dashboardHashParam(hash, 'recommendation')).toBe('42');
  });

  it('builds encoded dashboard handoff hashes', () => {
    expect(buildDashboardHash('marketing-recommendations', { recommendation: 42 }))
      .toBe('#marketing-recommendations?recommendation=42');
  });
});