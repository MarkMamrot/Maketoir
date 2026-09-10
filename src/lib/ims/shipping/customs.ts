import type { ShippingParcelDraft } from "./types";

export const SHIPPING_EXPORT_PURPOSES = [
  "sale",
  "gift",
  "sample",
  "return",
] as const;

export type ShippingExportPurpose = (typeof SHIPPING_EXPORT_PURPOSES)[number];

export type CustomsSourceLine = {
  soItemId: number;
  productId: string | null;
  sku: string;
  description: string | null;
  hsCode: string | null;
  countryOfOrigin: string | null;
  isDangerousOrRestricted: boolean;
  unitWeightKg: number | null;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
  taxTreatment: "ex_tax" | "inc_tax" | "no_tax";
};

export type NonSaleDeclaredValueInput = {
  soItemId: number;
  unitValue: number;
};

export type CustomsSnapshotItem = {
  soItemId: number;
  productId: string;
  sku: string;
  description: string;
  hsCode: string;
  countryOfOrigin: string;
  isDangerousOrRestricted: boolean;
  quantity: number;
  unitValue: number;
  totalValue: number;
  weightKg: number;
};

export type CustomsParcelSnapshot = {
  parcelNumber: number;
  items: CustomsSnapshotItem[];
  totalValue: number;
};

export type CustomsSnapshot = {
  exportPurpose: ShippingExportPurpose;
  declaredCurrency: "AUD";
  nonSaleValuesConfirmed: boolean;
  parcels: CustomsParcelSnapshot[];
  totalValue: number;
};

export type CustomsSnapshotResult =
  | { ok: true; snapshot: Readonly<CustomsSnapshot> }
  | { ok: false; errors: string[] };

const MONEY_SCALE = 100;
const ISO_ALPHA_2_CODES = new Set(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "),
);

export function normalizeIsoAlpha2(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return ISO_ALPHA_2_CODES.has(normalized) ? normalized : null;
}

export function normalizeHsCode(value: unknown): string | null {
  const normalized = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{6,14}$/.test(normalized) ? normalized : null;
}

export function getProductCustomsErrors(line: CustomsSourceLine): string[] {
  const label = line.sku || `order line ${line.soItemId}`;
  const errors: string[] = [];
  if (!line.productId) errors.push(`${label}: linked product is required.`);
  if (!String(line.description ?? "").trim())
    errors.push(`${label}: customs description is required.`);
  if (!normalizeHsCode(line.hsCode))
    errors.push(`${label}: HS code must contain 6 to 14 letters or numbers.`);
  if (!normalizeIsoAlpha2(line.countryOfOrigin))
    errors.push(`${label}: two-letter country of origin is required.`);
  if (line.isDangerousOrRestricted)
    errors.push(`${label}: dangerous or restricted goods cannot be shipped.`);
  if (!Number.isFinite(Number(line.unitWeightKg)) || Number(line.unitWeightKg) <= 0)
    errors.push(`${label}: a positive product weight is required.`);
  return errors;
}

export function calculateSaleDeclaredUnitValue(line: Pick<
  CustomsSourceLine,
  "unitPrice" | "discountPct" | "taxRate" | "taxTreatment"
>): number {
  const unitPrice = Number(line.unitPrice);
  const discountPct = Number(line.discountPct ?? 0);
  const taxRate = Number(line.taxRate ?? 0);
  if (
    !Number.isFinite(unitPrice) ||
    unitPrice < 0 ||
    !Number.isFinite(discountPct) ||
    discountPct < 0 ||
    discountPct > 100 ||
    !Number.isFinite(taxRate) ||
    taxRate < 0
  ) {
    return Number.NaN;
  }
  const discountedUnitPrice = unitPrice * (1 - discountPct / 100);
  return roundMoney(
    line.taxTreatment === "inc_tax"
      ? discountedUnitPrice / (1 + taxRate)
      : discountedUnitPrice,
  );
}

export function buildCustomsSnapshot(input: {
  exportPurpose: ShippingExportPurpose;
  lines: CustomsSourceLine[];
  parcels: ShippingParcelDraft[];
  nonSaleValues?: NonSaleDeclaredValueInput[];
  nonSaleValuesConfirmed?: boolean;
}): CustomsSnapshotResult {
  if (!SHIPPING_EXPORT_PURPOSES.includes(input.exportPurpose))
    return { ok: false, errors: ["Choose a valid export purpose."] };

  const linesById = new Map(input.lines.map((line) => [line.soItemId, line]));
  const allocatedLineIds = new Set(
    input.parcels.flatMap((parcel) => parcel.allocations.map((allocation) => allocation.soItemId)),
  );
  const allocatedLines = input.lines.filter((line) => allocatedLineIds.has(line.soItemId));
  const errors = allocatedLines.flatMap(getProductCustomsErrors);
  const manualValues = new Map<number, number>();

  if (input.exportPurpose !== "sale") {
    if (input.nonSaleValuesConfirmed !== true)
      errors.push("Confirm the declared values for this non-sale shipment.");
    const suppliedValues = Array.isArray(input.nonSaleValues) ? input.nonSaleValues : [];
    for (const declaredValue of suppliedValues) {
      if (!declaredValue || typeof declaredValue !== "object") {
        errors.push("Each declared value must identify an order line and positive unit value.");
        continue;
      }
      const unitValue = Number(declaredValue.unitValue);
      if (!Number.isInteger(declaredValue.soItemId) || !allocatedLineIds.has(declaredValue.soItemId)) {
        errors.push("A declared value refers to an unknown order line.");
      } else if (!Number.isFinite(unitValue) || unitValue <= 0) {
        errors.push(
          `${linesById.get(declaredValue.soItemId)?.sku || `Order line ${declaredValue.soItemId}`}: declared unit value must be greater than zero.`,
        );
      } else if (manualValues.has(declaredValue.soItemId)) {
        errors.push(`Order line ${declaredValue.soItemId}: declared value was supplied more than once.`);
      } else {
        manualValues.set(declaredValue.soItemId, roundMoney(unitValue));
      }
    }
    for (const line of allocatedLines) {
      if (!manualValues.has(line.soItemId))
        errors.push(`${line.sku || `Order line ${line.soItemId}`}: declared unit value is required.`);
    }
  }

  const parcels: CustomsParcelSnapshot[] = [];
  for (const parcel of input.parcels) {
    const items: CustomsSnapshotItem[] = [];
    for (const allocation of parcel.allocations) {
      const line = linesById.get(allocation.soItemId);
      if (!line) {
        errors.push(`Parcel ${parcel.parcelNumber} contains an unknown order line.`);
        continue;
      }
      const quantity = Number(allocation.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        errors.push(`Parcel ${parcel.parcelNumber} contains an invalid quantity.`);
        continue;
      }
      const unitValue = input.exportPurpose === "sale"
        ? calculateSaleDeclaredUnitValue(line)
        : manualValues.get(line.soItemId);
      if (unitValue == null || !Number.isFinite(unitValue) || unitValue <= 0) {
        errors.push(`${line.sku || `Order line ${line.soItemId}`}: declared unit value must be greater than zero.`);
        continue;
      }
      items.push({
        soItemId: line.soItemId,
        productId: line.productId ?? "",
        sku: line.sku,
        description: String(line.description ?? "").trim(),
        hsCode: normalizeHsCode(line.hsCode) ?? "",
        countryOfOrigin: normalizeIsoAlpha2(line.countryOfOrigin) ?? "",
        isDangerousOrRestricted: false,
        quantity,
        unitValue,
        totalValue: roundMoney(unitValue * quantity),
        weightKg: roundWeight(Number(line.unitWeightKg) * quantity),
      });
    }
    parcels.push({
      parcelNumber: parcel.parcelNumber,
      items,
      totalValue: roundMoney(items.reduce((sum, item) => sum + item.totalValue, 0)),
    });
  }

  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  const snapshot: CustomsSnapshot = {
    exportPurpose: input.exportPurpose,
    declaredCurrency: "AUD",
    nonSaleValuesConfirmed: input.exportPurpose === "sale" || input.nonSaleValuesConfirmed === true,
    parcels,
    totalValue: roundMoney(parcels.reduce((sum, parcel) => sum + parcel.totalValue, 0)),
  };
  return { ok: true, snapshot: deepFreeze(snapshot) };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * MONEY_SCALE) / MONEY_SCALE;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

export function getInternationalRecipientErrors(input: {
  country: unknown;
  name: unknown;
  lines: unknown;
  email: unknown;
  phone: unknown;
}): string[] {
  const errors: string[] = [];
  if (!normalizeIsoAlpha2(input.country))
    errors.push("destination country must be an ISO alpha-2 country code");
  if (!String(input.name ?? "").trim()) errors.push("recipient name is required");
  if (
    !Array.isArray(input.lines) ||
    !input.lines.some((line) => String(line ?? "").trim())
  ) {
    errors.push("recipient street address is required");
  }
  if (!String(input.email ?? "").trim() && !String(input.phone ?? "").trim())
    errors.push("recipient email or phone is required");
  return errors;
}

function roundWeight(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}