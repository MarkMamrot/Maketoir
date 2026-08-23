import { describe, expect, it } from 'vitest';

import { validateIntegrationOfferingInput } from '../validation';

const validInput = {
  slug: 'xero-accounting',
  name: 'Xero Accounting',
  category: 'accounting_erp',
  deliveryMode: 'native',
  publicSummary: 'Connect accounting workflows.',
  exampleProviders: ['Xero'],
  supportedWorkflows: ['Invoice sync'],
  qualificationQuestions: ['Which Xero edition do you use?'],
  internalNotes: 'Sales only',
  isEnabled: true,
};

describe('validateIntegrationOfferingInput', () => {
  it('normalizes a valid offering', () => {
    expect(validateIntegrationOfferingInput({ ...validInput, slug: '  Xero-Accounting  ' })).toMatchObject({
      value: { slug: 'xero-accounting', isEnabled: true },
    });
  });

  it.each([
    [{ ...validInput, deliveryMode: 'custom' }, 'deliveryMode is not supported.'],
    [{ ...validInput, category: 'other' }, 'category is not supported.'],
    [{ ...validInput, slug: 'xero accounting' }, 'slug must contain lowercase letters, numbers, and single hyphens only.'],
    [{ ...validInput, exampleProviders: 'Xero' }, 'exampleProviders must be a JSON array.'],
    [{ ...validInput, supportedWorkflows: [42] }, 'supportedWorkflows[0] must be text.'],
    [{ ...validInput, isEnabled: 1 }, 'isEnabled must be a boolean.'],
  ])('rejects invalid input', (input, error) => {
    expect(validateIntegrationOfferingInput(input)).toEqual({ error });
  });
});