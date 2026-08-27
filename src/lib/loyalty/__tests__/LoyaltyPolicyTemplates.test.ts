import { describe, expect, it } from 'vitest';

import { buildHostedLoyaltyPolicies } from '../LoyaltyPolicyTemplates';

const merchant = {
  legalName: 'Monsterthreads TGV Pty Ltd',
  tradingName: 'Monsterthreads',
  businessNumber: 'ABN 31 151 413 124',
  contactEmail: 'MARK@monsterthreads.com.au',
  contactAddress: 'Unit 9, 25 Ossary Street, Mascot NSW 2020, Australia',
  jurisdiction: 'New South Wales, Australia',
};

describe('hosted loyalty policy templates', () => {
  it('builds deterministic Australian retail policies from normalized merchant details', () => {
    const first = buildHostedLoyaltyPolicies(merchant);
    const second = buildHostedLoyaltyPolicies(merchant);

    expect(first).toEqual(second);
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.merchant.contactEmail).toBe('mark@monsterthreads.com.au');
    expect(first.termsMarkdown).toContain('Australian Consumer Law');
    expect(first.termsMarkdown).toContain('expires 90 days after issue');
    expect(first.privacyMarkdown).toContain('Office of the Australian Information Commissioner');
  });

  it('keeps loyalty enrolment separate from marketing consent', () => {
    const result = buildHostedLoyaltyPolicies(merchant);
    expect(result.termsMarkdown).toContain('does not by itself subscribe you to marketing');
    expect(result.privacyMarkdown).toContain('does not by itself consent to marketing');
  });

  it('rejects incomplete or invalid merchant details', () => {
    expect(() => buildHostedLoyaltyPolicies({ ...merchant, legalName: '' })).toThrow('Legal entity name is required');
    expect(() => buildHostedLoyaltyPolicies({ ...merchant, contactEmail: 'not-an-email' })).toThrow('must be valid');
  });
});