import 'server-only';
import { calculateCogsForPeriod } from '@/lib/xero/cogsCalculator';
import { allocateRows, projectReport } from './projection';
import { fields, groupRows, matches, metrics, summarise, type Field, type ReportRow } from './domain';
import { loadEvidence } from './repository';
import type { ReportRequest } from './request';

export async function buildReport(businessId: string, request: ReportRequest) {
  const evidence = await loadEvidence(businessId, request);
  let detail = projectReport({ ...evidence, basis: request.basis, from: request.from, toExclusive: request.toExclusive });
  const byMovement = new Map<number, typeof evidence.allocations>();
  for (const allocation of evidence.allocations) {
    const bucket = byMovement.get(allocation.movementId) ?? [];
    bucket.push(allocation);
    byMovement.set(allocation.movementId, bucket);
  }
  const idsFor = (row: ReportRow) => typeof row.movementId === 'number' ? [row.movementId]
    : typeof row.movementId === 'string' ? row.movementId.split(',').map(Number) : [];
  const batchMode = request.groups.includes('batch') || request.filters.some(filter => filter.field === 'batch');
  if (batchMode) detail = allocateRows(detail, evidence.allocations);
  else detail = detail.map(row => ({ ...row, batch: [...new Set(idsFor(row).flatMap(id => (byMovement.get(id) ?? []).map(allocation => `Layer ${allocation.layerId}${allocation.poRef ? ` / ${allocation.poRef}` : ''}`)))].join('; ') || null }));
  const dimensionFilters = request.groups.length ? request.filters.filter(filter => !metrics.includes(filter.field)) : request.filters;
  detail = detail.filter(row => matches(row, dimensionFilters));
  let result = request.groups.length ? groupRows(detail, request.groups) : detail;
  if (request.groups.length) result = result.filter(row => matches(row, request.filters.filter(filter => metrics.includes(filter.field))));
  if (request.groups.length) {
    const selectedGroups = new Set(result.map(row => row.id));
    detail = detail.filter(row => selectedGroups.has(JSON.stringify(request.groups.map(field => row[field]))));
  }
  result.sort((left, right) => {
    const first = left[request.sort];
    const second = right[request.sort];
    if (first == null || first === '') return second == null || second === '' ? left.id.localeCompare(right.id) : 1;
    if (second == null || second === '') return -1;
    const comparison = typeof first === 'number' && typeof second === 'number' ? first - second : String(first).localeCompare(String(second));
    return (request.direction === 'asc' ? comparison : -comparison) || left.id.localeCompare(right.id);
  });
  const pageRows = result.slice((request.page - 1) * request.pageSize, request.page * request.pageSize);
  const selectedMovements = new Set(detail.flatMap(idsFor));
  const pageMovements = new Set(pageRows.flatMap(idsFor));
  const periodMovements = evidence.movements.filter(movement => movement.date >= request.from && movement.date < request.toExclusive);
  const knownCost = (selected: typeof periodMovements) => selected.reduce((sum, movement) => sum + (movement.unitCost == null || movement.unitCost < 0 ? 0 : -movement.qtyChange * movement.unitCost), 0);
  const accounting = await calculateCogsForPeriod({ businessId, startDate: request.from, endDateExclusive: request.toExclusive });
  const selectedPeriodMovements = periodMovements.filter(movement => selectedMovements.has(movement.id));
  const selectedPeriodIds = new Set(selectedPeriodMovements.map(movement => movement.id));
  return {
    success: true as const, basis: request.basis, from: request.from, to: request.to,
    groups: request.groups, total: result.length, page: request.page, pageSize: request.pageSize,
    columns: fields, rows: pageRows, summary: summarise(detail),
    channels: groupRows(detail, ['channel', 'channelInstance']),
    allocations: evidence.allocations.filter(allocation => pageMovements.has(allocation.movementId)),
    reconciliation: {
      scope: 'Full unfiltered movement period; report filters affect the selected figure only.',
      accounting, recordedMovementCogs: knownCost(periodMovements), selectedMovementCogs: knownCost(selectedPeriodMovements),
      otherMovementTypesCogs: knownCost(periodMovements.filter(movement => movement.type === 'pos_return')),
      missingMovementCosts: periodMovements.filter(movement => movement.unitCost == null || movement.unitCost < 0).length,
      excludedHistoricalMovements: periodMovements.filter(movement => movement.historical).length,
      nonStockMovements: periodMovements.filter(movement => !movement.stockItem).length,
      outsideSalePeriodMovements: evidence.movements.filter(movement => selectedMovements.has(movement.id) && (movement.date < request.from || movement.date >= request.toExclusive)).length,
      allocationRoundingDifference: knownCost(selectedPeriodMovements.filter(movement => byMovement.has(movement.id)))
        - evidence.allocations.filter(allocation => selectedPeriodIds.has(allocation.movementId))
          .reduce((sum, allocation) => sum + (allocation.type === 'consume' ? allocation.value : allocation.type === 'restore' ? -allocation.value : 0), 0),
    },
    availability: {
      invoiceDate: 'Not recorded for live documents; imported history uses its captured invoice date. Live filtering falls back to sale/order date.',
      invoiceStatus: 'Last verified Xero snapshot where available; not payment, order or sync status.',
      batch: 'FIFO cost-layer references only. Supplier lot labels and physical picking evidence are not recorded.',
      salesRep: 'Not recorded; POS cashier is separate.',
      deliveryDate: 'Not recorded. Stock fulfilment timestamp is shown separately as shipment evidence.',
      brand: 'Current catalogue metadata, not a historical sales snapshot.',
      historical: 'Imported history lacks captured tax/currency/cost evidence; financial margin is unavailable.',
    },
    exportRows: result,
  };
}

export function reportColumns(request: ReportRequest): Field[] {
  return request.columns.length ? request.columns : Object.keys(fields) as Field[];
}