import { describe, expect, it } from 'vitest';

import { isCrmCustomerType, isRetailCrmType } from '../contactCrmAccess';

describe('contact CRM access', () => {
  it('offers CRM only for customer-capable contact types', () => {
    expect(isCrmCustomerType('retail_customer')).toBe(true);
    expect(isCrmCustomerType('b2b_customer')).toBe(true);
    expect(isCrmCustomerType('both')).toBe(true);
    expect(isCrmCustomerType('supplier')).toBe(false);
    expect(isCrmCustomerType('lead')).toBe(false);
  });

  it('limits POS and loyalty CRM data to retail customers', () => {
    expect(isRetailCrmType('retail_customer')).toBe(true);
    expect(isRetailCrmType('b2b_customer')).toBe(false);
    expect(isRetailCrmType('both')).toBe(false);
  });
});