import { describe, expect, it } from 'vitest';
import { getXeroHash, getXeroWorkspaceSection, isXeroHash, parseXeroHash } from '../navigation';

describe('Xero workspace navigation', () => {
  it.each([
    ['#xero/overview', 'overview'],
    ['#xero/setup/automation', 'setup-automation'],
    ['#xero/setup/ledger', 'setup-ledger'],
    ['#xero/setup/payments', 'setup-payments'],
    ['#xero/activity/history', 'activity-history'],
    ['#xero/activity/cogs', 'activity-cogs'],
    ['#xero/activity/payouts', 'activity-payouts'],
  ])('parses canonical route %s', (hash, expected) => {
    expect(parseXeroHash(hash)).toBe(expected);
  });

  it.each([
    ['#xero', 'overview'],
    ['#xero/mapping', 'setup-ledger'],
    ['#xero/sync', 'activity-history'],
    ['#xero/cogs', 'activity-cogs'],
    ['#xero/payouts', 'activity-payouts'],
  ])('preserves legacy route %s', (hash, expected) => {
    expect(parseXeroHash(hash)).toBe(expected);
  });

  it('falls back to overview for unknown Xero routes', () => {
    expect(parseXeroHash('#xero/not-real')).toBe('overview');
  });

  it('generates canonical hashes and workspace sections', () => {
    expect(getXeroHash('setup-ledger')).toBe('#xero/setup/ledger');
    expect(getXeroWorkspaceSection('setup-ledger')).toBe('setup');
    expect(getXeroWorkspaceSection('activity-history')).toBe('activity');
    expect(getXeroWorkspaceSection('overview')).toBe('overview');
  });

  it('recognizes root and nested Xero hashes', () => {
    expect(isXeroHash('#xero')).toBe(true);
    expect(isXeroHash('#xero/activity/history')).toBe(true);
    expect(isXeroHash('#settings-xero')).toBe(false);
  });
});