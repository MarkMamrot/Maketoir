import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import {
  findOnlineGatewayClearingAccount,
  isShopifyPaymentsGateway,
  normalizeOnlineGateway,
} from '@/lib/xero/onlineGatewayMappings';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import { syncDailySalesBatch, syncGiftCardLiabilityReclass } from '@/services/XeroSyncService';

export interface OnlineDailySalesSyncResult {
  xeroId: string | null;
  totalSales: number;
  totalTax: number;
  giftCardAmount: number;
  orderCount: number;
}

export async function syncOnlineDailySalesDay(
  businessId: string,
  date: string,
): Promise<OnlineDailySalesSyncResult> {
  return runImsForBusiness(businessId, async () => {
    const [totals, gatewayRows, gatewayMappings] = await Promise.all([
      imsQuery<{ total_sales: string; total_tax: string; gift_card_amount: string; order_count: string }>(
        `SELECT COALESCE(SUM(total_amount), 0) AS total_sales,
                COALESCE(SUM(tax_amount), 0) AS total_tax,
                COALESCE(SUM(gift_card_amount), 0) AS gift_card_amount,
                COUNT(*) AS order_count
           FROM ims_sales_orders
          WHERE business_id = ? AND DATE_FORMAT(order_date, '%Y-%m-%d') = ?
            AND so_type = 'online'
            AND (is_historical IS NULL OR is_historical = 0)
            AND status != 'cancelled'`,
        [businessId, date],
      ),
      imsQuery<{ gateway: string; total_sales: string; total_tax: string }>(
        `SELECT COALESCE(LOWER(TRIM(payment_gateway)), '_unknown') AS gateway,
                COALESCE(SUM(total_amount), 0) AS total_sales,
                COALESCE(SUM(tax_amount), 0) AS total_tax
           FROM ims_sales_orders
          WHERE business_id = ? AND DATE_FORMAT(order_date, '%Y-%m-%d') = ?
            AND so_type = 'online'
            AND (is_historical IS NULL OR is_historical = 0)
            AND status != 'cancelled'
          GROUP BY COALESCE(LOWER(TRIM(payment_gateway)), '_unknown')`,
        [businessId, date],
      ),
      query<{ gateway_name: string; clearing_account_code: string | null }>(
        `SELECT gateway_name, clearing_account_code
           FROM xero_gateway_mappings
          WHERE business_id = ?`,
        [businessId],
      ).catch(() => []),
    ]);

    const totalSales = Number(totals[0]?.total_sales ?? 0);
    const totalTax = Number(totals[0]?.total_tax ?? 0);
    const giftCardAmount = Number(totals[0]?.gift_card_amount ?? 0);
    const orderCount = Number(totals[0]?.order_count ?? 0);
    if (!(totalSales > 0)) {
      return { xeroId: null, totalSales, totalTax, giftCardAmount, orderCount };
    }

    const paymentRows = gatewayRows
      .map(row => {
        const gateway = normalizeOnlineGateway(row.gateway);
        const amount = Math.round((Number(row.total_sales) + Number(row.total_tax)) * 100) / 100;
        if (!(amount > 0)) return null;
        const accountCode = findOnlineGatewayClearingAccount(gateway, gatewayMappings);
        return {
          gateway,
          amount,
          accountCode,
          payoutManaged: isShopifyPaymentsGateway(gateway),
        };
      })
      .filter((row): row is { gateway: string; amount: number; accountCode: string | null; payoutManaged: boolean } => !!row);

    const missingMappings = paymentRows.filter(row => !row.payoutManaged && !row.accountCode);
    if (gatewayMappings.length > 0 && missingMappings.length > 0) {
      throw new Error(`Missing gateway clearing mapping for: ${missingMappings.map(row => row.gateway).join(', ')}`);
    }

    const clearingPayments = paymentRows
      .filter(row => !row.payoutManaged && !!row.accountCode)
      .map(row => ({
        accountCode: row.accountCode as string,
        amount: row.amount,
        label: row.gateway === '_unknown' ? 'Unknown' : row.gateway,
      }));
    const deferredShopifyTotal = paymentRows
      .filter(row => row.payoutManaged)
      .reduce((sum, row) => sum + row.amount, 0);
    const targetTotal = Math.round((totalSales + totalTax) * 100) / 100;
    if (clearingPayments.length > 0 && deferredShopifyTotal === 0) {
      const allocated = Math.round(clearingPayments.reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100;
      const delta = Math.round((targetTotal - allocated) * 100) / 100;
      if (Math.abs(delta) > 0.00001) {
        const lastPayment = clearingPayments[clearingPayments.length - 1];
        lastPayment.amount = Math.round((lastPayment.amount + delta) * 100) / 100;
      }
    }

    const xeroId = await syncDailySalesBatch(businessId, {
      date,
      channel: 'online',
      totalSales,
      totalTax,
      lineDescription: `Online Sales ${date} (${orderCount} orders)`,
      ...(clearingPayments.length > 0 ? { clearingPayments } : {}),
      payoutManaged: deferredShopifyTotal > 0,
      gatewayAllocations: paymentRows.map(row => ({
        gateway: row.gateway,
        amount: row.amount,
        payoutManaged: row.payoutManaged,
      })),
    });

    if (xeroId && giftCardAmount > 0) {
      await syncGiftCardLiabilityReclass({
        businessId,
        amount: giftCardAmount,
        date,
        channel: 'online',
        dedupeKey: `gift card liability online ${date}`,
      });
    }

    return { xeroId, totalSales, totalTax, giftCardAmount, orderCount };
  });
}