export type SupplierCreditTaxTreatment = 'ex_tax' | 'inc_tax' | 'no_tax';

export interface SupplierCreditTotalLine {
  qty: number | string;
  unit_cost: number | string;
  tax_rate?: number | string | null;
}

export function calculateSupplierCreditTotals(
  items: SupplierCreditTotalLine[],
  taxTreatment: SupplierCreditTaxTreatment,
): { subtotal: number; tax_amount: number; total_amount: number } {
  let subtotal = 0;
  let taxAmount = 0;

  for (const item of items) {
    const lineAmount = Math.abs(Number(item.qty || 0)) * Math.abs(Number(item.unit_cost || 0));
    const taxRate = Math.abs(Number(item.tax_rate || 0));
    if (taxTreatment === 'no_tax') {
      subtotal += lineAmount;
    } else if (taxTreatment === 'inc_tax' && taxRate > 0) {
      const lineSubtotal = lineAmount / (1 + taxRate);
      subtotal += lineSubtotal;
      taxAmount += lineAmount - lineSubtotal;
    } else {
      subtotal += lineAmount;
      taxAmount += lineAmount * taxRate;
    }
  }

  return {
    subtotal,
    tax_amount: taxAmount,
    total_amount: subtotal + taxAmount,
  };
}