import 'dotenv/config';

// Dry run (live Xero reads only):
//   npx tsx scripts/void-duplicate-online-xero-invoices-202609.ts --business=Monsterthreads
// Apply only after reviewing the generated JSON report and using its confirmation token:
//   npx tsx scripts/void-duplicate-online-xero-invoices-202609.ts --business=Monsterthreads --apply --confirm=<token>

import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { execute, getPool, query } from '@/services/MySQLService';
import { voidXeroInvoice } from '@/services/XeroSyncService';
import { xeroApiFetch } from '@/services/XeroService';

const INCIDENT_FROM = '2026-09-09';
const INCIDENT_TO = '2026-09-25';
const EXPECTED_CANDIDATES = 85;
const API_DELAY_MS = 1_200;

const args = new Map(
  process.argv.slice(2).map(argument => {
    const [key, ...value] = argument.split('=');
    return [key, value.join('=')];
  }),
);
const apply = args.has('--apply');
const requestedBusiness = args.get('--business')?.trim() || 'Monsterthreads';
const expectedCandidates = Number(args.get('--expected') || EXPECTED_CANDIDATES);
const suppliedConfirmation = args.get('--confirm')?.trim() || '';

if (!Number.isInteger(expectedCandidates) || expectedCandidates <= 0) {
  throw new Error('--expected must be a positive integer.');
}

type BusinessRow = {
  business_id: string;
  name: string;
  ims_db_name: string;
};

type CandidateRow = {
  sales_order_id: number;
  sales_order_number: string;
  order_date: string;
  total_amount: string;
  channel_instance_id: string;
  individual_xero_invoice_id: string;
  current_local_xero_invoice_id: string | null;
  batch_xero_invoice_id: string | null;
  batch_invoice_status: string | null;
  batch_invoice_total: string | null;
};

type InvoiceSnapshot = {
  InvoiceID?: string;
  InvoiceNumber?: string;
  Type?: string;
  Status?: string;
  Reference?: string;
  Total?: number;
  AmountDue?: number;
  AmountPaid?: number;
  AmountCredited?: number;
  Payments?: unknown[];
  CreditNotes?: unknown[];
};

type Finding = CandidateRow & {
  xero_status: string | null;
  xero_total: number | null;
  disposition: 'eligible' | 'already_terminal' | 'blocked';
  reason: string;
  applied_status?: 'voided' | 'failed';
  local_link_cleared?: boolean;
};

function assertSafeSchema(schema: string): void {
  if (!/^[A-Za-z0-9_]+$/.test(schema)) throw new Error(`Unsafe IMS schema name: ${schema}`);
}

function roundCurrency(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100) / 100;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function getInvoice(businessId: string, invoiceId: string): Promise<InvoiceSnapshot | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await xeroApiFetch(businessId, `/Invoices/${invoiceId}`);
      await wait(API_DELAY_MS);
      return response?.Invoices?.[0] ?? null;
    } catch (error) {
      lastError = error;
      if (!String(error).includes('(429)') || attempt === 3) throw error;
      await wait(65_000);
    }
  }
  throw lastError;
}

function classifyInvoice(candidate: CandidateRow, invoice: InvoiceSnapshot | null, batchIsLive: boolean): Finding {
  const status = String(invoice?.Status ?? '').toUpperCase() || null;
  const total = invoice ? roundCurrency(invoice.Total) : null;
  const base = { ...candidate, xero_status: status, xero_total: total };

  if (!invoice) return { ...base, disposition: 'blocked', reason: 'Invoice was not found in Xero.' };
  if (status === 'VOIDED' || status === 'DELETED') {
    return { ...base, disposition: 'already_terminal', reason: `Invoice is already ${status}.` };
  }
  if (candidate.batch_xero_invoice_id === candidate.individual_xero_invoice_id) {
    return { ...base, disposition: 'blocked', reason: 'The logged invoice ID is the canonical daily batch invoice ID.' };
  }
  if (!batchIsLive) {
    return { ...base, disposition: 'blocked', reason: 'The matching daily batch is missing or terminal in Xero.' };
  }
  if (invoice.Type !== 'ACCREC') {
    return { ...base, disposition: 'blocked', reason: `Expected ACCREC but found ${invoice.Type ?? 'unknown type'}.` };
  }
  if (String(invoice.Reference ?? '') !== candidate.sales_order_number) {
    return { ...base, disposition: 'blocked', reason: 'Xero reference does not match the Sales Order number.' };
  }
  if (Math.abs(roundCurrency(invoice.Total) - roundCurrency(candidate.total_amount)) > 0.01) {
    return { ...base, disposition: 'blocked', reason: 'Xero total does not match the Sales Order total.' };
  }
  if (!['DRAFT', 'AUTHORISED'].includes(status ?? '')) {
    return { ...base, disposition: 'blocked', reason: `Xero status ${status ?? 'unknown'} is not safe for automatic removal.` };
  }

  const amountPaid = roundCurrency(invoice.AmountPaid);
  const amountCredited = roundCurrency(invoice.AmountCredited);
  const payments = Array.isArray(invoice.Payments) ? invoice.Payments.length : 0;
  const credits = Array.isArray(invoice.CreditNotes) ? invoice.CreditNotes.length : 0;
  if (amountPaid !== 0 || amountCredited !== 0 || payments > 0 || credits > 0) {
    return {
      ...base,
      disposition: 'blocked',
      reason: `Invoice has settlements (paid=${amountPaid.toFixed(2)}, credited=${amountCredited.toFixed(2)}, payments=${payments}, credits=${credits}).`,
    };
  }

  return { ...base, disposition: 'eligible', reason: status === 'DRAFT' ? 'Safe to delete.' : 'Safe to void.' };
}

async function writeReport(report: Record<string, unknown>): Promise<string> {
  const outputDirectory = path.resolve('tmp');
  await mkdir(outputDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(outputDirectory, `void-duplicate-online-xero-invoices-${apply ? 'apply' : 'dry-run'}-${stamp}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
}

async function clearLocalInvoiceLink(schema: string, businessId: string, finding: Finding): Promise<boolean> {
  if (finding.current_local_xero_invoice_id !== finding.individual_xero_invoice_id) return false;
  const result = await execute(
    `UPDATE \`${schema}\`.ims_sales_orders
        SET xero_invoice_id = NULL, xero_invoice_number = NULL,
            xero_sync_status = 'synced', xero_synced_at = NOW()
      WHERE BINARY business_id = BINARY ? AND id = ?
        AND BINARY xero_invoice_id = BINARY ?`,
    [businessId, finding.sales_order_id, finding.individual_xero_invoice_id],
  );
  return result.affectedRows === 1;
}

async function main(): Promise<void> {
  let businessId: string | null = null;
  try {
  const businesses = await query<BusinessRow>(
    `SELECT business_id, name, ims_db_name
       FROM businesses
      WHERE deleted_at IS NULL
        AND (BINARY business_id = BINARY ? OR LOWER(name) = LOWER(?))`,
    [requestedBusiness, requestedBusiness],
  );
  if (businesses.length !== 1) {
    throw new Error(`Expected one active business matching "${requestedBusiness}", found ${businesses.length}.`);
  }

  const business = businesses[0];
  businessId = business.business_id;
  assertSafeSchema(business.ims_db_name);

  const candidates = await query<CandidateRow>(
    `SELECT DISTINCT
            sales_order.id AS sales_order_id,
            sales_order.so_number AS sales_order_number,
            DATE_FORMAT(sales_order.order_date, '%Y-%m-%d') AS order_date,
            sales_order.total_amount,
            sales_order.channel_instance_id,
            sync_log.xero_id AS individual_xero_invoice_id,
            sales_order.xero_invoice_id AS current_local_xero_invoice_id,
            online_batch.xero_invoice_id AS batch_xero_invoice_id,
            online_batch.invoice_status AS batch_invoice_status,
            online_batch.invoice_total AS batch_invoice_total
       FROM xero_sync_log sync_log
       JOIN \`${business.ims_db_name}\`.ims_sales_orders sales_order
         ON BINARY sales_order.business_id = BINARY sync_log.business_id
        AND sales_order.id = sync_log.reference_id
      LEFT JOIN xero_online_batches online_batch
         ON BINARY online_batch.business_id = BINARY sales_order.business_id
        AND BINARY online_batch.channel_instance_id = BINARY sales_order.channel_instance_id
        AND online_batch.batch_date = DATE(sales_order.order_date)
      WHERE BINARY sync_log.business_id = BINARY ?
        AND sync_log.sync_type = 'so_invoice'
        AND sync_log.status = 'success'
        AND sync_log.xero_id IS NOT NULL
        AND sales_order.so_type = 'online'
        AND DATE(sales_order.order_date) BETWEEN ? AND ?
      ORDER BY sales_order.id, sync_log.xero_id`,
    [business.business_id, INCIDENT_FROM, INCIDENT_TO],
  );

  if (candidates.length !== expectedCandidates) {
    throw new Error(`Candidate lock failed: expected ${expectedCandidates} unique order/invoice pairs, found ${candidates.length}.`);
  }

  const candidateHash = createHash('sha256')
    .update(candidates.map(row => `${row.sales_order_id}:${row.individual_xero_invoice_id}:${row.batch_xero_invoice_id ?? 'missing'}`).join('\n'))
    .digest('hex');
  const requiredConfirmation = `VOID-ONLINE-${expectedCandidates}-${candidateHash.slice(0, 12).toUpperCase()}`;

  const batchStatuses = new Map<string, string | null>();
  for (const batchId of [...new Set(candidates.map(row => row.batch_xero_invoice_id).filter((id): id is string => !!id))]) {
    const invoice = await getInvoice(business.business_id, batchId);
    batchStatuses.set(batchId, invoice ? String(invoice.Status ?? '').toUpperCase() : null);
  }

  const findings: Finding[] = [];
  for (const candidate of candidates) {
    const invoice = await getInvoice(business.business_id, candidate.individual_xero_invoice_id);
    const batchStatus = candidate.batch_xero_invoice_id ? batchStatuses.get(candidate.batch_xero_invoice_id) : null;
    const batchIsLive = !!batchStatus && !['VOIDED', 'DELETED'].includes(batchStatus);
    findings.push(classifyInvoice(candidate, invoice, batchIsLive));
  }

  const eligible = findings.filter(finding => finding.disposition === 'eligible');
  if (apply && suppliedConfirmation !== requiredConfirmation) {
    throw new Error(`Apply confirmation mismatch. Run dry mode, review its report, then pass --apply --confirm=${requiredConfirmation}`);
  }

  if (apply) {
    for (const finding of findings.filter(item => item.disposition === 'already_terminal')) {
      finding.local_link_cleared = await clearLocalInvoiceLink(business.ims_db_name, business.business_id, finding);
    }
    for (const finding of eligible) {
      const latestBatch = finding.batch_xero_invoice_id
        ? await getInvoice(business.business_id, finding.batch_xero_invoice_id)
        : null;
      const latestBatchStatus = String(latestBatch?.Status ?? '').toUpperCase();
      const latestBatchIsLive = !!latestBatch && !['VOIDED', 'DELETED'].includes(latestBatchStatus);
      const latestInvoice = await getInvoice(business.business_id, finding.individual_xero_invoice_id);
      const latestFinding = classifyInvoice(finding, latestInvoice, latestBatchIsLive);
      if (latestFinding.disposition !== 'eligible') {
        finding.disposition = latestFinding.disposition;
        finding.reason = `Apply-time check: ${latestFinding.reason}`;
        continue;
      }

      const result = await voidXeroInvoice(
        business.business_id,
        finding.individual_xero_invoice_id,
        Number(finding.sales_order_id),
      );
      finding.applied_status = result.voided ? 'voided' : 'failed';
      if (result.voided) {
        finding.local_link_cleared = await clearLocalInvoiceLink(business.ims_db_name, business.business_id, finding);
      } else {
        finding.reason = result.hasPayments ? 'Apply-time check found a payment.' : 'Xero did not confirm the void/delete.';
      }
      await wait(API_DELAY_MS);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    incidentWindow: { from: INCIDENT_FROM, to: INCIDENT_TO },
    business: { businessId: business.business_id, name: business.name },
    candidateCount: candidates.length,
    candidateHash,
    requiredApplyConfirmation: requiredConfirmation,
    summary: {
      eligible: findings.filter(finding => finding.disposition === 'eligible').length,
      alreadyTerminal: findings.filter(finding => finding.disposition === 'already_terminal').length,
      blocked: findings.filter(finding => finding.disposition === 'blocked').length,
      voidedThisRun: findings.filter(finding => finding.applied_status === 'voided').length,
      failedThisRun: findings.filter(finding => finding.applied_status === 'failed').length,
      localLinksCleared: findings.filter(finding => finding.local_link_cleared).length,
    },
    batchStatuses: Object.fromEntries(batchStatuses),
    findings,
  };
  const reportPath = await writeReport(report);

  console.log(JSON.stringify({ ...report.summary, candidateCount: candidates.length, candidateHash, requiredConfirmation, reportPath }, null, 2));
  if (!apply) console.log(`Dry run only. Review ${reportPath}, then rerun with --apply --confirm=${requiredConfirmation}`);
  if (apply && findings.some(finding => finding.applied_status === 'failed')) process.exitCode = 1;
  } catch (error) {
    if (apply) {
      await reportRuntimeIssue({
        businessId,
        source: 'XeroIncidentCleanup',
        operation: 'void_duplicate_online_invoices',
        severity: 'error',
        title: 'Duplicate online invoice cleanup failed',
        error,
        context: { incidentFrom: INCIDENT_FROM, incidentTo: INCIDENT_TO, expectedCandidates },
      }).catch(() => {});
    }
    throw error;
  } finally {
    await getPool().end();
    globalThis.__mysqlPool = undefined;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
