import { describe, expect, it } from 'vitest';

import { parseReconciliationRecipients, renderReconciliationEmail } from '../email';

describe('parseReconciliationRecipients', () => {
  it('normalizes and deduplicates valid addresses while retaining invalid entries', () => {
    expect(parseReconciliationRecipients(' Accounts@Example.com,invalid\naccounts@example.com;owner@example.com ')).toEqual({
      recipients: ['accounts@example.com', 'owner@example.com'],
      invalid: ['invalid'],
    });
  });
});

describe('renderReconciliationEmail', () => {
  it('renders safe issue summaries and escapes user-controlled text', () => {
    const email = renderReconciliationEmail({
      businessName: 'Shop & Co', actorName: '<Alex>', appUrl: 'https://solvantis.test/',
      issues: [{
        id: 9, severity: 'error', reference: 'SO-42', documentType: 'Sales order',
        discrepancy: 'Total', summary: '<script>alert(1)</script>', amount: 12.5,
        recommendedNextStep: 'Compare and recheck.',
      }],
    });

    expect(email.subject).toBe('Shop & Co: 1 Xero reconciliation issue');
    expect(email.html).toContain('Shop &amp; Co');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(email.html).toContain('https://solvantis.test/ims#xero/sync');
    expect(email.html).not.toContain('<script>');
  });
});