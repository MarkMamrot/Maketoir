import { describe, expect, it } from 'vitest';
import {
  canAccessLoginDestination,
  getLoginDestinationRoute,
  parseLoginDestination,
} from '../loginDestination';

describe('loginDestination', () => {
  it('accepts only known destinations', () => {
    expect(parseLoginDestination('ims')).toBe('ims');
    expect(parseLoginDestination('foresight')).toBe('foresight');
    expect(parseLoginDestination('pos')).toBe('pos');
    expect(parseLoginDestination('/admin')).toBeNull();
    expect(parseLoginDestination('https://example.com')).toBeNull();
  });

  it('uses the existing tier permission matrix', () => {
    expect(canAccessLoginDestination('PosUser', 'pos')).toBe(true);
    expect(canAccessLoginDestination('PosUser', 'ims')).toBe(false);
    expect(canAccessLoginDestination('PosManager', 'foresight')).toBe(false);
    expect(canAccessLoginDestination('Advisor', 'ims')).toBe(true);
    expect(canAccessLoginDestination('Advisor', 'pos')).toBe(false);
    expect(canAccessLoginDestination('Admin', 'foresight')).toBe(true);
  });

  it('maps destinations to fixed internal routes', () => {
    expect(getLoginDestinationRoute('ims')).toBe('/ims');
    expect(getLoginDestinationRoute('foresight')).toBe('/dashboard');
    expect(getLoginDestinationRoute('pos')).toBe('/pos');
  });
});