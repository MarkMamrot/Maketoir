import { emptyRow, exclusive, financials, numberOrNull, type Basis, type ReportRow } from './domain';

export interface SalesLine {
  source: 'pos' | 'so' | 'credit' | 'history'; documentId: number; lineId: number; variantId: string | null;
  orderRef: string; invoiceNo: string | null; saleDate: string; customer: string | null; channel: string;
  channelInstance: string | null; cashier: string | null; brand: string | null; sku: string | null; description: string | null;
  warehouse: string | null; locationId: number; status: string; currency: string; exchangeRate: number | null;
  qty: number; gross: number; lineTotal: number; taxRate: number; taxBasis: string; headerDiscount: number;
  headerNet: number; headerTax: number; historical: boolean; stockItem: boolean; restock: boolean;
  creditRef: string | null; reversedAt: string | null; invoiceStatus?: string | null;
}

export interface Movement {
  id: number; documentId: number; referenceType: string; sourceLineId: number | null; variantId: string;
  locationId: number; warehouse: string | null; date: string; type: string; qtyChange: number;
  unitCost: number | null; costMethod: string; historical: boolean; stockItem: boolean;
}

export interface Allocation {
  id: number; movementId: number; layerId: number; parentLayerId: number | null; sourceType: string;
  poRef: string | null; receiptDate: string; qty: number; unitCost: number; value: number; type: string;
}

const referenceTypes = { pos: 'pos_sale', so: 'sales_order', credit: 'credit_note', history: 'history' };

export function normaliseLines(lines: SalesLine[]): Array<SalesLine & { net: number; tax: number; evidence: string }> {
  const documents = new Map<string, SalesLine[]>();
  for (const line of lines) {
    const key = `${line.source}:${line.documentId}`;
    const group = documents.get(key) ?? [];
    group.push(line);
    documents.set(key, group);
  }
  const result: Array<SalesLine & { net: number; tax: number; evidence: string }> = [];
  for (const members of documents.values()) {
    const subtotal = members.reduce((sum, line) => sum + Math.abs(line.source === 'pos' ? line.lineTotal : exclusive(line.lineTotal, line.taxRate, line.taxBasis)), 0);
    const projected = members.map(line => {
      const lineNet = exclusive(line.lineTotal, line.taxRate, line.taxBasis);
      const weight = Math.abs(line.source === 'pos' ? line.lineTotal : lineNet);
      const headerShare = subtotal === 0 ? 0 : line.source === 'pos'
        ? exclusive(line.headerDiscount * weight / subtotal, line.taxRate, 'inc_tax')
        : line.headerDiscount * weight / subtotal;
      const net = lineNet - headerShare;
      const tax = line.taxBasis === 'no_tax' ? 0 : net * line.taxRate;
      return { ...line, gross: exclusive(line.gross, line.taxRate, line.taxBasis), net, tax, evidence: line.historical ? 'Historical: captured COGS unavailable' : 'Recorded sale' };
    });
    const projectedNet = projected.reduce((sum, line) => sum + line.net, 0);
    const projectedTax = projected.reduce((sum, line) => sum + line.tax, 0);
    const grouped = new Map<string, typeof projected[number]>();
    for (const line of projected) {
      const key = line.source === 'pos' && line.variantId ? line.variantId : String(line.lineId);
      const previous = grouped.get(key);
      if (!previous) grouped.set(key, line);
      else {
        previous.qty += line.qty;
        previous.gross += line.gross;
        previous.net += line.net;
        previous.tax += line.tax;
        previous.lineTotal += line.lineTotal;
        previous.evidence = 'Aggregated document/SKU: exact POS line attribution unavailable';
      }
    }
    result.push(...grouped.values());
    if (members[0].source !== 'history') {
      const adjustment = members[0].headerNet - projectedNet;
      const taxAdjustment = members[0].headerTax - projectedTax;
      if (Math.abs(adjustment) >= .005 || Math.abs(taxAdjustment) >= .005) {
        result.push({ ...members[0], lineId: -members[0].documentId, variantId: null, qty: 0,
          sku: null, description: 'Document freight / rounding / tax adjustment', gross: adjustment, net: adjustment,
          tax: taxAdjustment, stockItem: false, restock: false, evidence: 'Financial-only document adjustment' });
      }
    }
  }
  return result;
}

export function projectReport(input: { lines: SalesLine[]; movements: Movement[]; basis: Basis; from: string; toExclusive: string }) {
  const lines = normaliseLines(input.lines);
  const rows: ReportRow[] = [];
  const matched = new Set<number>();
  const movementIndex = new Map<string, Movement[]>();
  const peerCount = new Map<string, number>();
  const keyFor = (reference: string, documentId: number, variant: string | null) => `${reference}:${documentId}:${variant}`;
  for (const movement of input.movements) {
    const key = keyFor(movement.referenceType, movement.documentId, movement.variantId);
    const bucket = movementIndex.get(key) ?? [];
    bucket.push(movement);
    movementIndex.set(key, bucket);
  }
  for (const line of lines) {
    const key = keyFor(referenceTypes[line.source], line.documentId, line.variantId);
    peerCount.set(key, (peerCount.get(key) ?? 0) + 1);
  }
  const inRange = (date: string) => date >= input.from && date < input.toExclusive;
  const baseRow = (line: typeof lines[number], id: string) => Object.assign(emptyRow(id), {
    source: line.source, orderRef: line.orderRef, invoiceNo: line.invoiceNo, saleDate: line.saleDate,
    customer: line.customer, channel: line.channel, channelInstance: line.channelInstance, cashier: line.cashier,
    brand: line.brand, sku: line.sku, description: line.description, warehouse: line.warehouse,
    posLocation: line.source === 'pos' || line.channel === 'POS' ? line.warehouse : null,
    fulfilmentLocation: line.warehouse, currency: line.currency, orderStatus: line.status,
    invoiceStatus: line.invoiceStatus ?? null, creditRef: line.creditRef, quality: line.evidence,
    invoiceDate: line.source === 'history' ? line.saleDate.slice(0, 10) : null,
    sourceHref: line.source === 'so' ? `/ims#sales-orders/${line.documentId}` : line.source === 'credit' ? `/ims#credit-notes/${line.documentId}` : line.source === 'pos' ? `/ims#pos-sales/${line.documentId}` : null,
  });
  for (const line of lines) {
    const matchKey = keyFor(referenceTypes[line.source], line.documentId, line.variantId);
    const candidates = movementIndex.get(matchKey) ?? [];
    const movements = candidates.filter(movement => movement.sourceLineId != null && line.source !== 'pos'
      ? movement.sourceLineId === line.lineId : peerCount.get(matchKey) === 1);
    movements.forEach(movement => matched.add(movement.id));
    const sign = line.source === 'credit' ? -1 : 1;
    const cost = (movement: Movement) => movement.unitCost == null || movement.unitCost < 0 ? null : -movement.qtyChange * movement.unitCost;
    const completeQuantity = Math.abs(movements.reduce((sum, movement) => sum - movement.qtyChange, 0) - sign * line.qty) < .0001;
    const known = movements.every(movement => cost(movement) != null);
    const realisedCogs = !line.stockItem || !line.restock ? 0 : movements.length && known && completeQuantity
      ? movements.reduce((sum, movement) => sum + (cost(movement) ?? 0), 0) : null;
    const quantityByType = new Map<string, number>();
    for (const movement of movements) quantityByType.set(movement.type, (quantityByType.get(movement.type) ?? 0) + Math.abs(movement.qtyChange));
    const uncertainHistory = line.source === 'pos' && (quantityByType.has('pos_return')
      || (quantityByType.get('pos_sale') ?? 0) > Math.abs(line.qty) + .0001);
    const applyMoney = (row: ReportRow, fraction: number, cogs: number | null) => {
      row.qty = sign * line.qty * fraction;
      const unknown = line.taxBasis === 'unknown';
      row.documentNetSales = unknown ? null : sign * line.net * fraction;
      row.documentTax = unknown ? null : sign * line.tax * fraction;
      Object.assign(row, financials({ gross: unknown ? null : sign * line.gross * fraction, net: unknown ? null : sign * line.net * fraction,
        tax: unknown ? null : sign * line.tax * fraction, currency: line.currency, exchangeRate: line.exchangeRate, cogs }));
    };
    if (input.basis === 'sale') {
      for (const reversal of [false, true]) {
        const eventDate = reversal ? line.reversedAt : line.saleDate;
        if (!eventDate || !inRange(eventDate)) continue;
        const row = baseRow(line, `${line.source}:${line.documentId}:${line.lineId}${reversal ? ':reversal' : ''}`);
        const eventMovements = line.source === 'credit'
          ? movements.filter(movement => reversal ? movement.type === 'cn_return_reversed' : movement.type === 'cn_returned') : movements;
        const eventQuantity = eventMovements.reduce((sum, movement) => sum + Math.abs(movement.qtyChange), 0);
        const eventCost = !line.stockItem || !line.restock ? 0 : eventMovements.length && eventMovements.every(movement => cost(movement) != null)
          && (line.source !== 'credit' ? completeQuantity : Math.abs(eventQuantity - line.qty) < .0001)
          ? eventMovements.reduce((sum, movement) => sum + (cost(movement) ?? 0), 0) : null;
        applyMoney(row, reversal ? -1 : 1, line.source === 'credit' ? eventCost : realisedCogs);
        row.saleDate = eventDate;
        row.movementId = eventMovements.map(movement => movement.id).join(', ') || null;
        row.costMethod = [...new Set(eventMovements.map(movement => movement.costMethod))].join(', ') || null;
        row.movementDate = eventMovements.length === 1 ? eventMovements[0].date : null;
        row.quality = `${line.evidence}; ${line.source === 'history' ? 'imported invoice date' : 'sale-date fallback (invoice date not recorded)'}${row.cogs == null ? '; COGS incomplete/unfulfilled' : ''}${reversal ? '; credit reversal' : ''}`;
        rows.push(row);
      }
    } else {
      for (const movement of movements.filter(movement => inRange(movement.date))) {
        const row = baseRow(line, `movement:${movement.id}`);
        const signedQty = -movement.qtyChange;
        const correction = movement.type === 'cn_return_reversed';
        const normalType = line.source === 'credit' ? movement.type === 'cn_returned' : line.source === 'pos' ? movement.type === 'pos_sale' : movement.type === 'so_fulfilled';
        const excessQuantity = (quantityByType.get(movement.type) ?? 0) > Math.abs(line.qty) + .0001;
        const canAttribute = !uncertainHistory && !excessQuantity && line.qty !== 0 && (normalType || correction) && (correction || Math.sign(signedQty) === sign)
          && Math.abs(signedQty) <= Math.abs(line.qty) + .0001;
        if (canAttribute) applyMoney(row, signedQty / (sign * line.qty), cost(movement));
        else Object.assign(row, { qty: signedQty, cogs: cost(movement), quality: excessQuantity
          ? 'Cost-only: stock-event quantity exceeds source line; financial attribution unresolved'
          : 'Cost-only correction: original financial snapshot unavailable' });
        row.movementId = movement.id;
        row.movementDate = movement.date;
        row.warehouse = movement.warehouse;
        row.fulfilmentLocation = movement.warehouse;
        row.costMethod = movement.costMethod;
        row.shipmentDate = movement.type === 'so_fulfilled' ? movement.date : null;
        if (canAttribute) row.quality = `${line.evidence}; revenue attributed to stock event${cost(movement) == null ? '; captured cost missing' : ''}`;
        rows.push(row);
      }
      if ((!line.stockItem || !line.restock) && inRange(line.saleDate)) {
        const row = baseRow(line, `${line.source}:${line.documentId}:${line.lineId}:financial`);
        applyMoney(row, 1, 0);
        row.quality = `${line.evidence}; financial-only (no stock COGS)`;
        rows.push(row);
      }
      if ((!line.stockItem || !line.restock) && line.reversedAt && inRange(line.reversedAt)) {
        const row = baseRow(line, `${line.source}:${line.documentId}:${line.lineId}:reversal`);
        applyMoney(row, -1, 0);
        row.saleDate = line.reversedAt;
        row.quality = 'Financial-only credit reversal';
        rows.push(row);
      }
    }
  }
  if (input.basis === 'movement') for (const movement of input.movements) {
    if (matched.has(movement.id) || !inRange(movement.date)) continue;
    rows.push(Object.assign(emptyRow(`movement:${movement.id}`), { movementId: movement.id, movementDate: movement.date,
      source: movement.referenceType, orderRef: `${movement.referenceType} #${movement.documentId}`,
      warehouse: movement.warehouse, fulfilmentLocation: movement.warehouse, qty: -movement.qtyChange,
      cogs: movement.unitCost == null || movement.unitCost < 0 ? null : -movement.qtyChange * movement.unitCost,
      costMethod: movement.costMethod, currency: 'AUD', channel: movement.referenceType === 'pos_sale' ? 'POS' : 'Unresolved',
      quality: 'Unmatched stock movement: financial attribution unavailable' }));
  }
  return rows;
}

export function allocateRows(rows: ReportRow[], allocations: Allocation[]): ReportRow[] {
  const byMovement = new Map<number, Allocation[]>();
  for (const allocation of allocations) {
    const group = byMovement.get(allocation.movementId) ?? [];
    group.push(allocation);
    byMovement.set(allocation.movementId, group);
  }
  return rows.flatMap<ReportRow>(row => {
    const movementIds = typeof row.movementId === 'number' ? [row.movementId] : typeof row.movementId === 'string' ? row.movementId.split(',').map(Number) : [];
    const members = movementIds.flatMap(movementId => byMovement.get(movementId) ?? []);
    const direction = (member: Allocation) => member.type === 'restore' || member.type === 'inbound' ? -1 : 1;
    const quantity = members.reduce((sum, member) => sum + direction(member) * Math.abs(member.qty), 0);
    const value = members.reduce((sum, member) => sum + direction(member) * Math.abs(member.value), 0);
    if (!members.length) return [{ ...row, batch: null }];
    if (quantity === 0 || row.qty == null || Math.abs(quantity - Number(row.qty)) > .0001 || (value === 0 && row.cogs !== 0 && row.cogs != null)) {
      return [{ ...row, batch: null, quality: `${row.quality}; incomplete FIFO allocation coverage` }];
    }
    return members.map(member => {
      const fraction = direction(member) * Math.abs(member.qty) / quantity;
      const allocated = { ...row, id: `${row.id}:allocation:${member.id}`, batch: `Layer ${member.layerId}${member.poRef ? ` / ${member.poRef}` : ''}` };
      for (const field of ['qty', 'sales', 'discount', 'netSales', 'tax', 'documentNetSales', 'documentTax'] as const) {
        allocated[field] = row[field] == null ? null : Number(row[field]) * fraction;
      }
      allocated.cogs = row.cogs == null ? null : value === 0 ? 0 : Number(row.cogs) * direction(member) * Math.abs(member.value) / value;
      allocated.gp = allocated.netSales == null || allocated.cogs == null ? null : Number(allocated.netSales) - allocated.cogs;
      allocated.gpPercent = allocated.gp == null || allocated.netSales == null || allocated.netSales === 0 ? null : allocated.gp / Number(allocated.netSales) * 100;
      allocated.quality = `${row.quality}; revenue by allocated quantity; cost by recorded layer value reconciled to movement cost`;
      return allocated;
    });
  });
}