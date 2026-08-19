export function isCrmCustomerType(value: unknown): boolean {
  return ['lead', 'b2b_customer', 'retail_customer', 'both'].includes(String(value));
}

export function isRetailCrmType(value: unknown): boolean {
  return String(value) === 'retail_customer';
}