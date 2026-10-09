import { loadPostingReconciliations } from '@/lib/ims/cogsTraceability/postings';
import { parseRequest } from '@/lib/ims/cogsTraceability/request';
import type { AuditFinding } from './domain';
import { buildCogsPostingAuditFindings } from './cogsPostingFindings';

export async function loadCogsPostingAuditFindings(businessId: string, asOfDate: string): Promise<AuditFinding[]> {
  const start = new Date(`${asOfDate}T00:00:00Z`);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const request = parseRequest(new URLSearchParams({ from: start.toISOString().slice(0, 10), to: asOfDate, pageSize: '200' }), asOfDate);
  const ledger = await loadPostingReconciliations(businessId, request, { verifyXero: false });
  return buildCogsPostingAuditFindings(ledger);
}