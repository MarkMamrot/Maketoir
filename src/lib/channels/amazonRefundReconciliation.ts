import type { AmazonRefundObservation } from '@/lib/channels/amazonRefundObservation';
import type { AmazonReturnObservation } from '@/lib/channels/amazonReturnReport';
import { ImsCNRepo } from '@/lib/ims/ImsRepository';
import { imsQuery } from '@/services/IMSMySQLService';

interface EventRow { payload_json: string | Record<string, unknown> | null }

interface OrderLineRow {
  so_id: number;
  so_number: string;
  customer_id: number | null;
  location_id: number;
  source_so_item_id: number | null;
  variant_id: string | null;
  merchant_sku: string | null;
  local_sku: string | null;
  item_name: string | null;
}

function payload<T>(value: EventRow['payload_json']): T | null {
  if (value && typeof value === 'object') return value as T;
  try { return JSON.parse(String(value ?? '')) as T; } catch { return null; }
}

function duplicateEntry(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY';
}

type ReturnEvidence = AmazonReturnObservation & { salesOrderId?: number | null };
type RefundEvidence = AmazonRefundObservation & { salesOrderId?: number | null };

async function loadAmazonRefundEvidence(input: { businessId: string; channelInstanceId: string }) {
  const rows = await imsQuery<{ event_type: string; payload_json: EventRow['payload_json'] }>(
    `SELECT event_type, payload_json FROM ims_sales_channel_events
      WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'
        AND event_type IN ('return.observed','refund.observed') AND status = 'complete'`,
    [input.businessId, input.channelInstanceId],
  );
  const returns = rows.filter(row => row.event_type === 'return.observed')
    .map(row => payload<ReturnEvidence>(row.payload_json)).filter(Boolean) as ReturnEvidence[];
  const refunds = rows.filter(row => row.event_type === 'refund.observed')
    .map(row => payload<RefundEvidence>(row.payload_json)).filter(Boolean) as RefundEvidence[];
  const linkedRows = await imsQuery<{ external_return_id: string | null; external_refund_id: string | null }>(
    `SELECT external_return_id, external_refund_id FROM ims_credit_notes
      WHERE business_id = ? AND channel_instance_id = ? AND source = 'amazon'`,
    [input.businessId, input.channelInstanceId],
  );
  return {
    returns,
    refunds,
    linkedReturns: new Set(linkedRows.map(row => String(row.external_return_id ?? '')).filter(Boolean)),
    linkedRefunds: new Set(linkedRows.map(row => String(row.external_refund_id ?? '')).filter(Boolean)),
  };
}

export interface AmazonRefundResolutionGroup {
  amazonOrderId: string;
  returns: Array<{ amazonRmaId: string; requestedAt: string; refundedAmount: number; currencyCode: string; lineCount: number }>;
  refunds: Array<{ amazonRefundId: string; postedAt: string; currencyCode: string; sellerNetAmount: number }>;
}

export async function listAmazonRefundResolutionGroups(input: {
  businessId: string;
  channelInstanceId: string;
}): Promise<AmazonRefundResolutionGroup[]> {
  const evidence = await loadAmazonRefundEvidence(input);
  const orderIds = new Set([...evidence.returns.map(item => item.amazonOrderId), ...evidence.refunds.map(item => item.amazonOrderId)]);
  return [...orderIds].map(amazonOrderId => {
    const returnsByRma = new Map<string, ReturnEvidence[]>();
    for (const item of evidence.returns.filter(item => item.amazonOrderId === amazonOrderId && item.refundedAmount > 0
      && item.currencyCode === 'AUD' && !evidence.linkedReturns.has(item.amazonRmaId))) {
      returnsByRma.set(item.amazonRmaId, [...(returnsByRma.get(item.amazonRmaId) ?? []), item]);
    }
    const refundsById = new Map<string, RefundEvidence>();
    for (const item of evidence.refunds.filter(item => item.amazonOrderId === amazonOrderId && item.currencyCode === 'AUD'
      && !evidence.linkedRefunds.has(item.amazonRefundId))) refundsById.set(item.amazonRefundId, item);
    return {
      amazonOrderId,
      returns: [...returnsByRma.entries()].map(([amazonRmaId, lines]) => ({
        amazonRmaId,
        requestedAt: lines[0].requestedAt,
        refundedAmount: lines.reduce((sum, line) => sum + line.refundedAmount, 0),
        currencyCode: lines[0].currencyCode,
        lineCount: lines.length,
      })),
      refunds: [...refundsById.values()].map(item => ({
        amazonRefundId: item.amazonRefundId,
        postedAt: item.postedAt,
        currencyCode: item.currencyCode,
        sellerNetAmount: item.sellerNetAmount,
      })),
    };
  }).filter(group => group.returns.length > 0 && group.refunds.length > 0
    && (group.returns.length > 1 || group.refunds.length > 1));
}

export async function resolveAmazonRefundPair(input: {
  businessId: string;
  channelInstanceId: string;
  amazonOrderId: string;
  amazonRmaId: string;
  amazonRefundId: string;
  createdBy: string;
}): Promise<{ creditNoteId: number }> {
  const evidence = await loadAmazonRefundEvidence(input);
  if (evidence.linkedReturns.has(input.amazonRmaId) || evidence.linkedRefunds.has(input.amazonRefundId)) {
    throw new Error('The selected return or refund is already linked to a credit note.');
  }
  const returnLines = evidence.returns.filter(item => item.amazonOrderId === input.amazonOrderId
    && item.amazonRmaId === input.amazonRmaId && item.refundedAmount > 0 && item.currencyCode === 'AUD');
  const refund = evidence.refunds.find(item => item.amazonOrderId === input.amazonOrderId
    && item.amazonRefundId === input.amazonRefundId && item.currencyCode === 'AUD');
  if (returnLines.length === 0 || !refund) {
    throw new Error('The selected Amazon return and refund are not a valid pair for this order.');
  }
  try {
    const creditNoteId = await createAmazonRefundDraft({ ...input, returnLines, refund });
    if (!creditNoteId) throw new Error('The selected return or refund is already linked to a credit note.');
    return { creditNoteId };
  } catch (error) {
    if (duplicateEntry(error)) throw new Error('The selected return or refund is already linked to a credit note.');
    throw error;
  }
}

async function createAmazonRefundDraft(input: {
  businessId: string;
  channelInstanceId: string;
  amazonOrderId: string;
  amazonRmaId: string;
  returnLines: ReturnEvidence[];
  refund: RefundEvidence;
  createdBy: string;
}): Promise<number | null> {
  const existing = await imsQuery<{ id: number }>(
    `SELECT id FROM ims_credit_notes
      WHERE business_id = ? AND channel_instance_id = ?
        AND (external_return_id = ? OR external_refund_id = ?) LIMIT 1`,
    [input.businessId, input.channelInstanceId, input.amazonRmaId, input.refund.amazonRefundId],
  );
  if (existing[0]) return null;
  const orderLines = await imsQuery<OrderLineRow>(
    `SELECT so.id AS so_id, so.so_number, so.customer_id, so.location_id,
            soi.id AS source_so_item_id, soi.variant_id,
            mapping.external_variant_id AS merchant_sku, variant.sku AS local_sku,
            COALESCE(product.name, soi.notes) AS item_name
       FROM ims_sales_orders so
       LEFT JOIN ims_sales_order_items soi ON soi.business_id = so.business_id AND soi.so_id = so.id
       LEFT JOIN ims_product_variants variant ON variant.variant_id = soi.variant_id
       LEFT JOIN ims_products product ON product.business_id = so.business_id AND product.product_id = variant.product_id
       LEFT JOIN ims_sales_channel_product_mappings mapping
         ON mapping.business_id = so.business_id AND mapping.channel_instance_id = so.channel_instance_id
        AND mapping.variant_id = soi.variant_id AND mapping.mapping_status = 'linked'
      WHERE so.business_id = ? AND so.channel_instance_id = ? AND so.sales_channel = 'amazon'
        AND so.external_order_id = ?`,
    [input.businessId, input.channelInstanceId, input.amazonOrderId],
  );
  const order = orderLines[0];
  if (!order) throw new Error('The matching Amazon order has not been imported yet.');
  const items = input.returnLines.map(line => {
    const source = orderLines.find(orderLine => orderLine.merchant_sku === line.merchantSku) ?? null;
    return {
      variant_id: source?.variant_id ?? null,
      code: line.merchantSku,
      name: line.itemName ?? source?.item_name ?? `Amazon return ${input.amazonRmaId}`,
      qty: line.quantity,
      unit_price: Math.round((line.refundedAmount / line.quantity) * 10_000) / 10_000,
      price_basis: 'custom' as const,
      restock: false,
      source_so_item_id: source?.source_so_item_id ?? null,
      tax_rate: 0.1,
    };
  });
  return ImsCNRepo.create({
    customer_id: order.customer_id,
    so_id: order.so_id,
    original_so_number: order.so_number,
    location_id: order.location_id,
    source: 'amazon',
    settlement_method: 'external',
    settlement_status: 'complete',
    channel_instance_id: input.channelInstanceId,
    external_return_id: input.amazonRmaId,
    external_refund_id: input.refund.amazonRefundId,
    cn_date: input.refund.postedAt.slice(0, 10),
    reference: `Amazon refund ${input.refund.amazonRefundId}`,
    tax_treatment: 'inc_tax',
    tax_code: 'OUTPUT',
    notes: 'Externally settled by Amazon. Review returned quantities and select Restock only for goods physically received and sellable.',
  }, items, input.businessId, input.createdBy);
}

export async function reconcileAmazonRefunds(input: {
  businessId: string;
  channelInstanceId: string;
}): Promise<{ created: number; ambiguous: number; ignored: number }> {
  const evidence = await loadAmazonRefundEvidence(input);
  const { returns, refunds, linkedReturns, linkedRefunds } = evidence;
  const result = { created: 0, ambiguous: 0, ignored: 0 };
  const orderIds = new Set([...returns.map(item => item.amazonOrderId), ...refunds.map(item => item.amazonOrderId)]);

  for (const amazonOrderId of orderIds) {
    const orderReturns = returns.filter(item => item.amazonOrderId === amazonOrderId && item.refundedAmount > 0
      && item.currencyCode === 'AUD' && !linkedReturns.has(item.amazonRmaId));
    const returnsByRma = new Map<string, typeof orderReturns>();
    for (const item of orderReturns) returnsByRma.set(item.amazonRmaId, [...(returnsByRma.get(item.amazonRmaId) ?? []), item]);
    const refundsById = new Map<string, AmazonRefundObservation & { salesOrderId?: number }>();
    for (const refund of refunds.filter(item => item.amazonOrderId === amazonOrderId && item.currencyCode === 'AUD'
      && !linkedRefunds.has(item.amazonRefundId))) refundsById.set(refund.amazonRefundId, refund);
    if (returnsByRma.size === 0 || refundsById.size === 0) { result.ignored += 1; continue; }
    if (returnsByRma.size !== 1 || refundsById.size !== 1) { result.ambiguous += 1; continue; }
    const [amazonRmaId, returnLines] = [...returnsByRma.entries()][0];
    const refund = [...refundsById.values()][0];
    try {
      const creditNoteId = await createAmazonRefundDraft({
        ...input, amazonOrderId, amazonRmaId, returnLines, refund, createdBy: 'Amazon reconciliation',
      });
      if (creditNoteId) result.created += 1;
      else result.ignored += 1;
    } catch (error) {
      if (duplicateEntry(error) || (error instanceof Error && error.message.includes('has not been imported'))) result.ignored += 1;
      else throw error;
    }
  }
  return result;
}