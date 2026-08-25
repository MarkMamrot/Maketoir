import { describe, expect, it } from 'vitest';
import { extractHttpsUnsubscribeUrl } from '../gmailClient';

describe('customer-service Gmail metadata', () => {
  it('selects the HTTPS option from a standard unsubscribe header', () => {
    expect(extractHttpsUnsubscribeUrl('<mailto:leave@example.com>, <https://example.com/unsubscribe?id=42>'))
      .toBe('https://example.com/unsubscribe?id=42');
  });

  it('rejects non-HTTPS and malformed unsubscribe targets', () => {
    expect(extractHttpsUnsubscribeUrl('<mailto:leave@example.com>')).toBeNull();
    expect(extractHttpsUnsubscribeUrl('<http://example.com/unsubscribe>')).toBeNull();
    expect(extractHttpsUnsubscribeUrl('javascript:alert(1)')).toBeNull();
  });
});