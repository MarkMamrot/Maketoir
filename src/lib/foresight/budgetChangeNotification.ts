import { Resend } from 'resend';
import { ConfigRepository } from '@/lib/db/ConfigRepository';
import type { BudgetChangePreview } from './executionPreflight';

export const BUDGET_CHANGE_NOTIFICATION_EMAIL = 'Marketing_BudgetChangeNotificationEmail';

export function isValidNotificationEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function money(amountMicros: number, currencyCode: string): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: currencyCode || 'AUD',
  }).format(amountMicros / 1_000_000);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

export async function getBudgetChangeNotificationEmail(businessId: string): Promise<string> {
  return (await ConfigRepository.get(businessId, BUDGET_CHANGE_NOTIFICATION_EMAIL))?.trim().toLowerCase() ?? '';
}

export async function sendBudgetChangeNotification(input: {
  recipient: string;
  recommendationId: number;
  executionId: number;
  changes: BudgetChangePreview[];
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');
  const direction = input.changes[0]?.direction === 'increase' ? 'increased' : 'reduced';
  const rows = input.changes.map(change => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e2e8f0;">${escapeHtml(change.campaignName)}</td>
      <td style="padding:10px;border-bottom:1px solid #e2e8f0;">${money(change.currentAmountMicros, change.currencyCode)}</td>
      <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:700;">${money(change.proposedAmountMicros, change.currencyCode)}</td>
      <td style="padding:10px;border-bottom:1px solid #e2e8f0;">${change.direction === 'increase' ? '+' : '-'}${change.changePercent}%</td>
    </tr>`).join('');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'Solvantis <onboarding@resend.dev>',
    to: input.recipient,
    subject: `Google Ads budgets ${direction} by Solvantis`,
    html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#0f172a;">
      <h1 style="font-size:22px;">Google Ads budget change verified</h1>
      <p>Solvantis submitted and verified the following approved Google Ads budget change.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead><tr><th style="padding:10px;text-align:left;">Campaign</th><th style="padding:10px;text-align:left;">Before</th><th style="padding:10px;text-align:left;">After</th><th style="padding:10px;text-align:left;">Change</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:12px;color:#64748b;">Recommendation #${input.recommendationId} · Execution #${input.executionId} · Verified ${new Date().toISOString()}</p>
    </div>`,
  }, { idempotencyKey: `foresight-budget-change-${input.executionId}` });
  if (error) throw new Error(error.message);
}