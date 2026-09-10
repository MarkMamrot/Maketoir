import {
  calculateSaleDeclaredUnitValue,
  getProductCustomsErrors,
  normalizeHsCode,
  normalizeIsoAlpha2,
  type ShippingExportPurpose,
} from "./customs";

export type WorkspaceCustomsLine = {
  id: number;
  productId: string | null;
  sku: string;
  productName: string;
  customsDescription: string | null;
  hsCode: string | null;
  countryOfOrigin: string | null;
  isDangerousOrRestricted: boolean;
  weightKg: number | null;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
};

export type WorkspaceCustomsAllocation = {
  soItemId: number;
  quantity: number;
};

export type WorkspaceCustomsRow = WorkspaceCustomsLine & {
  quantity: number;
  unitValue: number | null;
  totalValue: number | null;
  errors: string[];
};

export function buildWorkspaceCustomsRows(input: {
  lines: WorkspaceCustomsLine[];
  allocations: WorkspaceCustomsAllocation[];
  exportPurpose: ShippingExportPurpose;
  taxTreatment: "ex_tax" | "inc_tax" | "no_tax";
  nonSaleValues: Record<number, string>;
}): WorkspaceCustomsRow[] {
  const quantities = new Map<number, number>();
  for (const allocation of input.allocations) {
    quantities.set(
      allocation.soItemId,
      (quantities.get(allocation.soItemId) ?? 0) + Number(allocation.quantity || 0),
    );
  }
  return input.lines
    .filter((line) => (quantities.get(line.id) ?? 0) > 0)
    .map((line) => {
      const quantity = quantities.get(line.id) ?? 0;
      const saleUnitValue = calculateSaleDeclaredUnitValue({
        unitPrice: line.unitPrice,
        discountPct: line.discountPct,
        taxRate: line.taxRate,
        taxTreatment: input.taxTreatment,
      });
      const manualValue = Number(input.nonSaleValues[line.id]);
      const unitValue = input.exportPurpose === "sale"
        ? saleUnitValue
        : Number.isFinite(manualValue) && manualValue > 0
          ? Math.round((manualValue + Number.EPSILON) * 100) / 100
          : null;
      return {
        ...line,
        customsDescription: String(line.customsDescription ?? "").trim(),
        hsCode: normalizeHsCode(line.hsCode),
        countryOfOrigin: normalizeIsoAlpha2(line.countryOfOrigin),
        quantity,
        unitValue: unitValue != null && Number.isFinite(unitValue) ? unitValue : null,
        totalValue: unitValue != null && Number.isFinite(unitValue)
          ? Math.round((unitValue * quantity + Number.EPSILON) * 100) / 100
          : null,
        errors: getProductCustomsErrors({
          soItemId: line.id,
          productId: line.productId,
          sku: line.sku,
          description: line.customsDescription,
          hsCode: line.hsCode,
          countryOfOrigin: line.countryOfOrigin,
          isDangerousOrRestricted: line.isDangerousOrRestricted,
          unitWeightKg: line.weightKg,
          unitPrice: line.unitPrice,
          discountPct: line.discountPct,
          taxRate: line.taxRate,
          taxTreatment: input.taxTreatment,
        }),
      };
    });
}

export function getWorkspaceCustomsBlockers(input: {
  rows: WorkspaceCustomsRow[];
  exportPurpose: ShippingExportPurpose;
  nonSaleValuesConfirmed: boolean;
}): string[] {
  const blockers = input.rows.flatMap((row) => row.errors);
  if (input.exportPurpose === "sale") {
    for (const row of input.rows) {
      if (row.unitValue == null || row.unitValue <= 0)
        blockers.push(`${row.sku || row.productName}: calculated declared unit value must be greater than zero.`);
    }
  } else {
    for (const row of input.rows) {
      if (row.unitValue == null)
        blockers.push(`${row.sku || row.productName}: declared unit value is required.`);
    }
    if (!input.nonSaleValuesConfirmed)
      blockers.push("Confirm the declared values for this non-sale shipment.");
  }
  return [...new Set(blockers)];
}

export function buildNonSaleDeclaredValueInputs(
  rows: WorkspaceCustomsRow[],
): Array<{ soItemId: number; unitValue: number }> {
  return rows
    .filter((row) => row.unitValue != null)
    .map((row) => ({ soItemId: row.id, unitValue: row.unitValue! }));
}