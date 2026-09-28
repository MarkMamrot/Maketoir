import { describe, expect, it } from 'vitest';

import { LeadDiscoveryValidationError, normalizeApprovedLeadCandidate } from '../leadDiscoveryService';

const validCandidate = {
  candidateKey: 'westfield-sydney-store-1',
  batchId: 'westfield-sydney-2026-09-28',
  sourceQuery: 'Westfield Sydney retailers',
  name: 'Example Retailer',
  email: ' SALES@EXAMPLE.COM ',
  website_url: 'https://www.example.com/contact#team',
  discoveredAt: '2026-09-28T10:00:00Z',
  sources: [{ url: 'https://www.westfield.com.au/sydney/store/example', kind: 'centre_directory' as const, confidence: 0.9 }],
};

describe('lead discovery candidate validation', () => {
  it('normalizes approved Australian retailer details', () => {
    expect(normalizeApprovedLeadCandidate(validCandidate)).toMatchObject({
      name: 'Example Retailer',
      email: 'sales@example.com',
      website_url: 'https://www.example.com/contact',
      country: 'Australia',
    });
  });

  it('requires a useful public contact channel or address', () => {
    expect(() => normalizeApprovedLeadCandidate({ ...validCandidate, email: null, website_url: null }))
      .toThrow('email, phone, official website, or postal address');
  });

  it('rejects invalid source evidence', () => {
    expect(() => normalizeApprovedLeadCandidate({ ...validCandidate, sources: [{ url: 'javascript:alert(1)', kind: 'other' }] }))
      .toThrow(LeadDiscoveryValidationError);
  });

  it('rejects confidence outside the supported range', () => {
    expect(() => normalizeApprovedLeadCandidate({ ...validCandidate, sources: [{ url: 'https://example.com', kind: 'official_website', confidence: 2 }] }))
      .toThrow('between 0 and 1');
  });

  it('keeps inferred owner email separate and tied to the official domain', () => {
    const normalized = normalizeApprovedLeadCandidate({
      ...validCandidate,
      people: [{
        personKey: 'jane-smith-owner',
        fullName: 'Jane Smith',
        role: 'owner',
        sourceUrl: 'https://example.com/about',
        contacts: [{ type: 'email', value: 'jane.smith@example.com', evidence: 'inferred' }],
      }],
    });
    expect(normalized.email).toBe('sales@example.com');
    expect(normalized.people[0].contacts?.[0]).toMatchObject({
      value: 'jane.smith@example.com',
      evidence: 'inferred',
      verificationStatus: 'not_checked',
    });
  });

  it('rejects inferred addresses on a domain unrelated to the official website', () => {
    expect(() => normalizeApprovedLeadCandidate({
      ...validCandidate,
      people: [{
        personKey: 'jane-smith-owner', fullName: 'Jane Smith', role: 'owner',
        sourceUrl: 'https://example.com/about',
        contacts: [{ type: 'email', value: 'jane@personal.example', evidence: 'inferred' }],
      }],
    })).toThrow('official website domain');
  });

  it('stores a generic mailbox guess as an unverified business hypothesis', () => {
    const normalized = normalizeApprovedLeadCandidate({
      ...validCandidate,
      businessContacts: [{ type: 'email', value: 'info@example.com', evidence: 'inferred' }],
    });
    expect(normalized.businessContacts[0]).toMatchObject({
      value: 'info@example.com',
      evidence: 'inferred',
      verificationStatus: 'not_checked',
    });
    expect(normalized.email).toBe('sales@example.com');
  });
});