import { AMAZON_DELIVERY_REVIEW_DAYS, deliveryReviewDeadline } from './amazonDeliveryEvidence';

export const AMAZON_PII_RETENTION_DAYS = AMAZON_DELIVERY_REVIEW_DAYS;
export const AMAZON_PII_INVENTORY_PAGE_SIZE = 25;

export const AMAZON_PII_SOURCES = [
  { id: 'order-address', title: 'Order address fields', kind: 'structured', detail: 'Populated delivery address fields; country-only values can also be counted.' },
  { id: 'linked-contact', title: 'Linked customer details', kind: 'structured', detail: 'Non-generic names or contact details on linked customers. These contacts may be shared with other orders; do not delete them blindly.' },
  { id: 'shipment-recipient', title: 'Shipment recipient snapshots', kind: 'structured', detail: 'Non-empty recipient snapshots retained for Amazon orders, including cancelled and historical shipments.' },
  { id: 'shipment-amendment', title: 'Shipment amendment history', kind: 'content-review', detail: 'Previous, desired or result snapshots may retain recipient details after a shipment is edited.' },
  { id: 'shipping-label', title: 'Stored shipping label links', kind: 'content-review', detail: 'Counts stored links, including expired links. Label contents are not downloaded or inspected.' },
  { id: 'order-text', title: 'Order free-text fields', kind: 'content-review', detail: 'Customer purchase-order references and non-standard order notes require review; the generated Amazon order note is excluded.' },
  { id: 'order-item-text', title: 'Order line descriptions', kind: 'content-review', detail: 'Descriptions may simply be product titles. Presence alone does not prove buyer PII.' },
  { id: 'credit-note-text', title: 'Linked credit-note text', kind: 'content-review', detail: 'Notes, references and reversal reasons on credit notes linked to Amazon orders require review; financial amounts are not selected.' },
  { id: 'credit-note-item-text', title: 'Linked credit-note descriptions', kind: 'content-review', detail: 'Retained refund item names can copy original order descriptions and require separate review.' },
  { id: 'channel-event', title: 'Amazon event payloads', kind: 'content-review', detail: 'Stored event payloads and errors need content review. A return delivery date is not the original buyer delivery date.' },
  { id: 'channel-job', title: 'Amazon channel job payloads', kind: 'content-review', detail: 'Includes pending and completed payloads and errors, even when no local order can be linked.' },
  { id: 'shipping-job', title: 'Shipping confirmation payloads', kind: 'content-review', detail: 'Retained request, response and error records associated with Amazon shipments require review.' },
] as const;

export type AmazonPiiSourceId = typeof AMAZON_PII_SOURCES[number]['id'];
export type AmazonPiiSourceKind = typeof AMAZON_PII_SOURCES[number]['kind'];

export interface AmazonPiiSourceInventory {
  id: AmazonPiiSourceId;
  availability: 'available' | 'unavailable';
  records: number | null;
}

export interface AmazonPiiOrderInventory {
  salesOrderId: number;
  amazonOrderReference: string | null;
  orderDate: string | null;
  ageDays: number | null;
  sourceIds: AmazonPiiSourceId[];
  earliestVerifiedDeliveryAt: string | null;
  reviewDeadlineAt: string | null;
}

export interface AmazonPiiInventoryReport {
  mode: 'read-only';
  generatedAt: string;
  summary: {
    amazonOrders: number;
    ordersWithPotentialPii: number;
    ordersWithStructuredFields: number;
    ordersWithUnreviewedContent: number;
    agedOrdersNeedingReview: number;
    confirmedOverdue: null;
  };
  sources: AmazonPiiSourceInventory[];
  deliveryEvidence: {
    availability: 'available' | 'unavailable';
    ordersWithVerifiedDelivery: number | null;
    ordersPastReviewDeadline: number | null;
  };
  orders: AmazonPiiOrderInventory[];
  afterId: number;
  nextAfterId: number | null;
}

export const AMAZON_PII_MANUAL_REVIEW_AREAS = [
  'Generated invoices, packing slips, downloaded labels and exported files.',
  'Carrier tracking identifiers and links, and retained evidence codes or article fingerprints: confirm classification and justified retention; these references must not preserve a hidden lookup to deleted buyer details.',
  'Application logs, Runtime Issues, support attachments, cached or temporary copies, and manually reassigned or unlinked customer/refund records.',
  'Database backups and restored copies, carrier-held data and other processor copies.',
] as const;

export function amazonPiiOrderNeedsPriorityReview(ageDays: number | null): boolean {
  if (ageDays === null) return false;
  if (!Number.isSafeInteger(ageDays) || ageDays < 0) throw new Error('Invalid inventory order age.');
  return ageDays >= AMAZON_PII_RETENTION_DAYS;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Amazon PII inventory response.');
  return value as Record<string, unknown>;
}

function nonnegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Amazon PII inventory count.');
  return value;
}

function sourceId(value: unknown): AmazonPiiSourceId {
  const source = AMAZON_PII_SOURCES.find(item => item.id === value);
  if (!source) throw new Error('Invalid Amazon PII inventory source.');
  return source.id;
}

export function validateAmazonPiiInventoryReport(value: unknown): AmazonPiiInventoryReport {
  const report = object(value);
  if (report.mode !== 'read-only' || typeof report.generatedAt !== 'string' || !Number.isFinite(Date.parse(report.generatedAt))) {
    throw new Error('Invalid Amazon PII inventory metadata.');
  }
  const summary = object(report.summary);
  if (summary.confirmedOverdue !== null) throw new Error('Delivery evidence alone cannot confirm overdue PII without content classification.');
  const delivery = object(report.deliveryEvidence);
  if (delivery.availability !== 'available' && delivery.availability !== 'unavailable') throw new Error('Invalid delivery evidence coverage.');
  if (delivery.availability === 'unavailable' && (delivery.ordersWithVerifiedDelivery !== null || delivery.ordersPastReviewDeadline !== null)) {
    throw new Error('Unavailable delivery evidence cannot have counts.');
  }
  if (!Array.isArray(report.sources) || report.sources.length !== AMAZON_PII_SOURCES.length
    || !Array.isArray(report.orders) || report.orders.length > AMAZON_PII_INVENTORY_PAGE_SIZE) {
    throw new Error('Invalid Amazon PII inventory coverage.');
  }
  const sources = report.sources.map<AmazonPiiSourceInventory>(value => {
    const source = object(value);
    if (source.availability !== 'available' && source.availability !== 'unavailable') throw new Error('Invalid inventory source availability.');
    if (source.availability === 'unavailable' && source.records !== null) throw new Error('Unavailable inventory source cannot have a count.');
    return {
      id: sourceId(source.id), availability: source.availability,
      records: source.availability === 'available' ? nonnegativeInteger(source.records) : null,
    };
  });
  if (new Set(sources.map(source => source.id)).size !== AMAZON_PII_SOURCES.length) throw new Error('Duplicate inventory sources.');
  const orders = report.orders.map(value => {
    const order = object(value);
    const salesOrderId = nonnegativeInteger(order.salesOrderId);
    if (salesOrderId === 0 || !Array.isArray(order.sourceIds) || order.sourceIds.length === 0
      || !(order.amazonOrderReference === null || (typeof order.amazonOrderReference === 'string' && order.amazonOrderReference.length === 19 && /^\d{3}-\d{7}-\d{7}$/.test(order.amazonOrderReference)))
      || !(order.orderDate === null || (typeof order.orderDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(order.orderDate)))) {
      throw new Error('Invalid Amazon PII order reference.');
    }
    const ageDays = order.ageDays === null ? null : nonnegativeInteger(order.ageDays);
    const earliest = order.earliestVerifiedDeliveryAt;
    const deadline = order.reviewDeadlineAt;
    if (!(deadline === null || typeof deadline === 'string') || !(earliest === null || (typeof earliest === 'string' && Number.isFinite(Date.parse(earliest))
      && new Date(earliest).toISOString() === earliest)) || deadline !== (earliest ? deliveryReviewDeadline(earliest) : null)
      || (delivery.availability === 'unavailable' && earliest !== null)) throw new Error('Invalid delivery review deadline.');
    return { salesOrderId, amazonOrderReference: order.amazonOrderReference, orderDate: order.orderDate, ageDays,
      sourceIds: order.sourceIds.map(sourceId), earliestVerifiedDeliveryAt: earliest, reviewDeadlineAt: deadline };
  });
  return {
    mode: 'read-only', generatedAt: report.generatedAt,
    summary: {
      amazonOrders: nonnegativeInteger(summary.amazonOrders),
      ordersWithPotentialPii: nonnegativeInteger(summary.ordersWithPotentialPii),
      ordersWithStructuredFields: nonnegativeInteger(summary.ordersWithStructuredFields),
      ordersWithUnreviewedContent: nonnegativeInteger(summary.ordersWithUnreviewedContent),
      agedOrdersNeedingReview: nonnegativeInteger(summary.agedOrdersNeedingReview),
      confirmedOverdue: null,
    },
    sources, orders, deliveryEvidence: {
      availability: delivery.availability,
      ordersWithVerifiedDelivery: delivery.availability === 'available' ? nonnegativeInteger(delivery.ordersWithVerifiedDelivery) : null,
      ordersPastReviewDeadline: delivery.availability === 'available' ? nonnegativeInteger(delivery.ordersPastReviewDeadline) : null,
    }, afterId: nonnegativeInteger(report.afterId),
    nextAfterId: report.nextAfterId === null ? null : nonnegativeInteger(report.nextAfterId),
  };
}
