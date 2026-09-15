export interface AmazonReturnObservation {
  amazonOrderId: string;
  amazonRmaId: string;
  merchantSku: string;
  asin: string | null;
  itemName: string | null;
  requestedAt: string;
  status: string;
  quantity: number;
  reason: string | null;
  resolution: string | null;
  returnType: string | null;
  deliveredAt: string | null;
  refundedAmount: number;
  currencyCode: string;
}

function field(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const value = row[name];
    if (value != null) return value.trim();
  }
  return '';
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function parseMoney(value: string): number {
  const parsed = Number(value.replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? Math.round(Math.abs(parsed) * 100) / 100 : 0;
}

function splitTsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === '\t' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('Amazon returns report contains an unterminated quoted value.');
  cells.push(cell);
  return cells;
}

export function parseAmazonReturnsReport(report: string): AmazonReturnObservation[] {
  const lines = report.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) return [];
  const headers = splitTsvLine(lines[0]);
  const observations: AmazonReturnObservation[] = [];
  for (const line of lines.slice(1)) {
    const values = splitTsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] ?? '']));
    const amazonOrderId = field(row, 'Order ID', 'order-id');
    const amazonRmaId = field(row, 'Amazon RMA ID', 'amazon-rma-id');
    const merchantSku = field(row, 'Merchant SKU', 'merchant-sku');
    const requestedAt = field(row, 'Return request date', 'return-request-date');
    const status = field(row, 'Return request status', 'return-request-status');
    const quantity = parsePositiveInteger(field(row, 'Return quantity', 'return-quantity'));
    if (!amazonOrderId || !amazonRmaId || !merchantSku || !requestedAt || !status || quantity === 0) continue;
    observations.push({
      amazonOrderId,
      amazonRmaId,
      merchantSku,
      asin: field(row, 'ASIN', 'asin') || null,
      itemName: field(row, 'Item Name', 'item-name') || null,
      requestedAt,
      status,
      quantity,
      reason: field(row, 'Return Reason', 'return-reason') || null,
      resolution: field(row, 'Resolution', 'resolution') || null,
      returnType: field(row, 'Return type', 'return-type') || null,
      deliveredAt: field(row, 'Return delivery date', 'return-delivery-date') || null,
      refundedAmount: parseMoney(field(row, 'Refunded Amount', 'refunded-amount')),
      currencyCode: (field(row, 'Currency code', 'currency-code') || 'AUD').toUpperCase(),
    });
  }
  return observations;
}

export function amazonReturnEventId(observation: AmazonReturnObservation): string {
  return `return:${observation.amazonOrderId}:${observation.amazonRmaId}:${observation.merchantSku}`.slice(0, 191);
}