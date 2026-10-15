'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AMAZON_PII_MANUAL_REVIEW_AREAS, AMAZON_PII_RETENTION_DAYS, AMAZON_PII_SOURCES,
  amazonPiiOrderNeedsPriorityReview, validateAmazonPiiInventoryReport, type AmazonPiiInventoryReport,
} from '@/lib/securityCompliance/amazonPiiInventory';
import styles from './SecurityComplianceView.module.css';
import { deliveryReviewIsDue } from '@/lib/securityCompliance/amazonDeliveryEvidence';

export default function AmazonPiiInventoryView({ onHelp }: { onHelp: () => void }) {
  const [report, setReport] = useState<AmazonPiiInventoryReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previousCursors, setPreviousCursors] = useState<number[]>([]);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function load(afterId: number, history: number[]) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(''); setReport(null);
    try {
      const response = await fetch(`/api/admin/security-compliance/amazon-pii-inventory?after=${afterId}`,
        { cache: 'no-store', signal: controller.signal });
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid Amazon PII inventory response.');
      const result = body as Record<string, unknown>;
      if (!response.ok || result.success !== true) {
        throw new Error(typeof result.error === 'string' ? result.error : 'Amazon PII inventory could not be read.');
      }
      const loaded = validateAmazonPiiInventoryReport(result.report);
      if (loaded.afterId !== afterId) throw new Error('The inventory returned a different order cursor.');
      if (controller.signal.aborted) return;
      setReport(loaded); setPreviousCursors(history);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Amazon PII inventory could not be read.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  const incomplete = report && (report.sources.some(source => source.availability === 'unavailable') || report.deliveryEvidence.availability === 'unavailable');
  return <section className={styles.card} aria-labelledby="amazon-pii-inventory-title">
    <div className={styles.heading}>
      <div>
        <h2 id="amazon-pii-inventory-title">Amazon PII inventory and dry run</h2>
        <p>Read-only, for the active business selected in the header. Policy responsibilities remain organization-wide.</p>
      </div>
      <button type="button" onClick={onHelp}>Amazon PII inventory help</button>
    </div>
    <p>This report counts potential buyer details and retained copies without showing names, addresses, phone numbers, raw payloads or label URLs. It does not call Amazon or a carrier, delete data, or change orders.</p>
    <div className={styles.warning}>
      <strong>Evidence-based review, not automatic deletion</strong>
      <p>The earliest verified original buyer-delivery timestamp sets a 30-day review deadline, including split shipments. A parcel delivery does not prove all parcels arrived or that identifying copies were removed. Fulfilment, shipment completion, order age and return-delivery dates are not substitutes.</p>
    </div>
    <div className={styles.actions}>
      <button type="button" disabled={loading} onClick={() => void load(0, [])}>{loading ? 'Reading inventory...' : 'Run read-only inventory'}</button>
    </div>
    {loading && <p role="status">Reading the active business inventory...</p>}
    {error && <p role="alert" className={styles.error}>{error} Run the inventory again to retry; no previous results are shown.</p>}
    {report && <>
      <p>Snapshot: {new Date(report.generatedAt).toLocaleString('en-AU')}. Counts cover the whole active business; the order list is paginated.</p>
      {incomplete && <div role="alert" className={styles.warning}>
        <strong>Partial coverage - not a clean result</strong>
        <p>One or more data sources are unavailable. Counts and order flags include only available sources. Resolve the coverage warning in Runtime Issues before treating this as a complete inventory.</p>
      </div>}
      <dl className={styles.inventoryMetrics}>
        <div><dt>Amazon orders</dt><dd>{report.summary.amazonOrders}</dd></div>
        <div><dt>Orders with potential PII or content to review</dt><dd>{report.summary.ordersWithPotentialPii}</dd></div>
        <div><dt>Orders with structured fields</dt><dd>{report.summary.ordersWithStructuredFields}</dd></div>
        <div><dt>Orders with unreviewed content</dt><dd>{report.summary.ordersWithUnreviewedContent}</dd></div>
        <div><dt>Orders aged {AMAZON_PII_RETENTION_DAYS}+ days needing review</dt><dd>{report.summary.agedOrdersNeedingReview}</dd></div>
        <div><dt>Confirmed overdue</dt><dd>Not assessable</dd></div>
        <div><dt>Orders with verified delivery evidence</dt><dd>{report.deliveryEvidence.ordersWithVerifiedDelivery ?? 'Unavailable'}</dd></div>
        <div><dt>Potential-PII orders past delivery review deadline</dt><dd>{report.deliveryEvidence.ordersPastReviewDeadline ?? 'Unavailable'}</dd></div>
      </dl>
      <p>Order age is a UTC calendar-day triage measure, not a deletion deadline. Delivery review uses the verified timestamp plus exactly 30 days, not the polling time. Confirmed overdue PII remains not assessable until content is classified; populated fields and links are not proof of PII.</p>
      <h3>Stored-data inventory</h3>
      <ul className={styles.inventoryList}>
        {AMAZON_PII_SOURCES.map(source => {
          const measured = report.sources.find(item => item.id === source.id);
          return <li key={source.id}>
            <strong>{source.title}: {measured?.availability === 'available' ? measured.records : 'Unavailable'}</strong>
            <p>{source.detail}</p>
          </li>;
        })}
      </ul>
      <p>These are source-record counts, not unique buyers, and cannot be added together. Linked contacts are counted once per source; Amazon events and channel jobs include unlinked records. Order flags show only copies linked to that order.</p>
      <h3>Order review candidates</h3>
      <p>Local order IDs are listed in ascending order. No order in this report is authorized for automatic disposal.</p>
      {report.orders.length === 0
        ? <p>No order-linked candidates were found on this page. Unlinked records and manual-review areas may still need attention.</p>
        : <ul className={styles.inventoryList}>
          {report.orders.map(order => <li key={order.salesOrderId}>
            <strong>Sales order #{order.salesOrderId}</strong>
            <p>Amazon reference: {order.amazonOrderReference ?? 'Unavailable or withheld'} | Order date: {order.orderDate ?? 'Unavailable'} | Age: {order.ageDays === null ? 'Unknown' : `${order.ageDays} days`}</p>
            {order.reviewDeadlineAt
              ? <p>Earliest verified original delivery: {order.earliestVerifiedDeliveryAt}. Review deadline: {order.reviewDeadlineAt}. {deliveryReviewIsDue(order.earliestVerifiedDeliveryAt!, new Date(report.generatedAt)) ? 'Delivery-based review deadline reached.' : 'Delivery-based review deadline not yet reached.'}</p>
              : <p>{amazonPiiOrderNeedsPriorityReview(order.ageDays) ? 'Priority review: older order; delivery evidence still required.' : 'Delivery evidence required before a disposal deadline can be set.'}</p>}
            <ul>{order.sourceIds.map(id => <li key={id}>{AMAZON_PII_SOURCES.find(source => source.id === id)?.title}</li>)}</ul>
          </li>)}
        </ul>}
      <div className={styles.actions}>
        <button type="button" disabled={loading || previousCursors.length === 0} onClick={() => {
          const history = previousCursors.slice(0, -1);
          void load(previousCursors[previousCursors.length - 1], history);
        }}>Previous order page</button>
        <button type="button" disabled={loading || report.nextAfterId === null} onClick={() => {
          if (report.nextAfterId !== null) void load(report.nextAfterId, [...previousCursors, report.afterId]);
        }}>Next order page</button>
      </div>
    </>}
    <h3>Outside the automatic scan</h3>
    <ul>{AMAZON_PII_MANUAL_REVIEW_AREAS.map(area => <li key={area}>{area}</li>)}</ul>
    <p>Zero detected records is not evidence of complete disposal. Free-text classification, external copies, re-import prevention and backup/restoration handling still require verification.</p>
  </section>;
}
