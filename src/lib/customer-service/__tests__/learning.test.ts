import { describe, expect, it } from 'vitest';
import { redactCustomerServiceLearningText } from '../learning';

describe('customer-service learning redaction', () => {
  it('removes common customer identifiers before evidence is stored', () => {
    const result = redactCustomerServiceLearningText(
      'Email jane@example.com, call 0412 345 678 about SO-2026-1234 or #56789 at 12 Smith Street.',
    );
    expect(result).toBe('Email [email], call [phone] about [reference] or [order] at [address].');
  });
});