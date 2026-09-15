import { getAmazonChannelAccess } from '@/lib/channels/amazonCredentials';
import { importAmazonRefundObservations } from '@/lib/channels/amazonRefundImport';
import { normalizeAmazonRefundTransactions } from '@/lib/channels/amazonRefundObservation';
import { reconcileAmazonRefunds } from '@/lib/channels/amazonRefundReconciliation';
import { listAmazonFinancialTransactions } from '@/lib/channels/amazonSpApi';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

const DEFAULT_LOOKBACK_DAYS = 30;
const CURSOR_OVERLAP_DAYS = 2;
const MAX_PAGES = 20;

export async function syncAmazonRefundsForChannel(input: {
  businessId: string;
  channelInstanceId: string;
  now?: Date;
}): Promise<{ scanned: number; observed: number; ignored: number; created: number; ambiguous: number }> {
  const instance = await SalesChannelInstanceRepository.getForBusiness(input.businessId, input.channelInstanceId);
  if (!instance || instance.provider !== 'amazon') throw new Error('Amazon channel not found.');
  const access = await getAmazonChannelAccess(input.businessId, input.channelInstanceId);
  if (!access) throw new Error('Amazon authorization is missing.');
  const now = input.now ?? new Date();
  const postedBeforeMs = now.getTime() - 2 * 60_000;
  const fallback = postedBeforeMs - DEFAULT_LOOKBACK_DAYS * 86_400_000;
  const saved = new Date(String(instance.settings.refundsLastPostedAt ?? ''));
  const postedAfterMs = Number.isFinite(saved.getTime())
    ? Math.max(fallback, saved.getTime() - CURSOR_OVERLAP_DAYS * 86_400_000)
    : fallback;
  const postedAfter = new Date(postedAfterMs).toISOString();
  const postedBefore = new Date(postedBeforeMs).toISOString();

  try {
    return await runImsForBusiness(input.businessId, async () => {
      const totals = { scanned: 0, observed: 0, ignored: 0 };
      let nextToken: string | null = null;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await listAmazonFinancialTransactions(access.accessToken, { postedAfter, postedBefore, nextToken });
        totals.scanned += response.transactions.length;
        const imported = await importAmazonRefundObservations({
          businessId: input.businessId,
          channelInstanceId: input.channelInstanceId,
          observations: normalizeAmazonRefundTransactions(response.transactions),
        });
        totals.observed += imported.observed;
        totals.ignored += imported.ignored;
        nextToken = response.nextToken;
        if (!nextToken) break;
        if (page === MAX_PAGES - 1) throw new Error('Amazon refund synchronization exceeded its safe page limit.');
      }
      const reconciled = await reconcileAmazonRefunds({
        businessId: input.businessId, channelInstanceId: input.channelInstanceId,
      });
      await SalesChannelInstanceRepository.setAmazonRefundSyncCursorForBusiness({
        businessId: input.businessId, channelInstanceId: input.channelInstanceId, lastPostedAt: postedBefore,
        ambiguousCount: reconciled.ambiguous,
      });
      return { ...totals, ...reconciled };
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: input.businessId,
      source: 'amazon.refunds',
      operation: 'sync_refunds',
      title: 'Amazon refunds could not be synchronized',
      error,
      context: { channelInstanceId: input.channelInstanceId, postedAfter, postedBefore },
      reference: { type: 'sales_channel_instance', id: input.channelInstanceId },
    }).catch(() => null);
    throw error;
  }
}