import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import {
  findOnlineGatewayClearingAccount,
  findOnlineGatewayMapping,
  isShopifyPaymentsGateway,
  normalizeOnlineGateway,
  type OnlineGatewayMapping,
} from '@/lib/xero/onlineGatewayMappings';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import { syncDailySalesBatch, syncGiftCardLiabilityReclass } from '@/services/XeroSyncService';
import { getXeroDocumentPolicy } from '@/lib/xero/documentPolicyRepository';
import { assertXeroAccountingEnabled } from '@/lib/ims/businessOperations';

function isPayPalGateway(value: string): boolean {
  return normalizeOnlineGateway(value).includes('paypal');
}

interface OnlineBatchOrderRow {
  sales_channel: string | null;
  native_checkout_id: string | null;
  shopify_order_id: string | null;
  shopify_order_name: string | null;
  payment_gateway: string | null;
  total_amount: string;
  tax_amount: string;
}

export function getOnlineBatchOrderIdentity(row: Pick<OnlineBatchOrderRow, 'sales_channel' | 'native_checkout_id' | 'shopify_order_id' | 'shopify_order_name'>): {
  id: string;
  reference: string;
} | null {
  if (row.sales_channel === 'native_shop') {
    const checkoutId = String(row.native_checkout_id ?? '').trim();
    return checkoutId ? { id: `native-${checkoutId}`, reference: `Native order ${checkoutId}` } : null;
  }
  const orderId = String(row.shopify_order_id ?? '').trim();
  if (!orderId) return null;
  const orderName = String(row.shopify_order_name ?? '').trim();
  return { id: orderId, reference: orderName || `Shopify order ${orderId}` };
}

export function calculateGatewayFee(grossAmount: number, fixedAmount: number, percentageRate: number): number {
  return Math.round((fixedAmount + grossAmount * percentageRate / 100) * 100) / 100;
}

function hasCalculatedFees(gateway: string, mapping: OnlineGatewayMapping | null): boolean {
  return !isShopifyPaymentsGateway(gateway)
    && !isPayPalGateway(gateway)
    && Boolean(mapping?.deduct_fee_enabled)
    && Boolean(mapping?.fee_account_code);
}

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
    await assertXeroAccountingEnabled(businessId);
    const policy = await getXeroDocumentPolicy(businessId);
    const timeZone = await getBusinessTimeZone(businessId);
    const today = new Date().toLocaleDateString('sv-SE', { timeZone });
    if (date >= today) {
      throw new Error(`Online daily sales can only be synced for completed business days. ${date} is still open in ${timeZone}.`);
    }

    const [totals, gatewayRows, orderRows, gatewayMappings] = await Promise.all([
      imsQuery<{ total_sales: string; total_tax: string; gift_card_amount: string; order_count: string }>(
        `SELECT COALESCE(SUM(total_amount), 0) AS total_sales,
                COALESCE(SUM(tax_amount), 0) AS total_tax,
                COALESCE(SUM(gift_card_amount), 0) AS gift_card_amount,
                COUNT(*) AS order_count
           FROM ims_sales_orders
          WHERE business_id = ? AND DATE_FORMAT(order_date, '%Y-%m-%d') = ?
            AND so_type = 'online'
            AND COALESCE(is_staff_preview_test, 0) = 0
            AND (is_historical IS NULL OR is_historical = 0)
            AND status != 'cancelled'`,
        [businessId, date],
      ),
      imsQuery<{ gateway: string; total_sales: string; total_tax: string }>(
        `SELECT gateway, COALESCE(SUM(total_sales), 0) AS total_sales, COALESCE(SUM(total_tax), 0) AS total_tax
           FROM (
             SELECT COALESCE(LOWER(TRIM(payment_gateway)), '_unknown') AS gateway,
                    total_amount AS total_sales, tax_amount AS total_tax
               FROM ims_sales_orders
              WHERE business_id = ? AND DATE_FORMAT(order_date, '%Y-%m-%d') = ?
                AND so_type = 'online' AND COALESCE(sales_channel, '') <> 'native_shop'
                AND COALESCE(is_staff_preview_test, 0) = 0
                AND (is_historical IS NULL OR is_historical = 0) AND status != 'cancelled'
             UNION ALL
             SELECT CASE WHEN sop.notes LIKE 'Native Store Credit %' THEN 'store_credit' ELSE 'stripe' END AS gateway,
                    sop.amount AS total_sales, 0 AS total_tax
               FROM ims_sales_orders so
               JOIN ims_sales_order_payments sop ON sop.so_id = so.id AND sop.business_id = so.business_id
              WHERE so.business_id = ? AND DATE_FORMAT(so.order_date, '%Y-%m-%d') = ?
                AND so.so_type = 'online' AND so.sales_channel = 'native_shop'
                AND COALESCE(so.is_staff_preview_test, 0) = 0
                AND (so.is_historical IS NULL OR so.is_historical = 0) AND so.status != 'cancelled'
           ) gateway_sales GROUP BY gateway`,
        [businessId, date, businessId, date],
      ),
      imsQuery<OnlineBatchOrderRow>(
        `SELECT sales_channel, native_checkout_id, shopify_order_id, shopify_order_name,
                payment_gateway, total_amount, tax_amount
           FROM ims_sales_orders
          WHERE business_id = ? AND DATE_FORMAT(order_date, '%Y-%m-%d') = ?
            AND so_type = 'online' AND COALESCE(sales_channel, '') <> 'native_shop'
            AND COALESCE(is_staff_preview_test, 0) = 0
            AND (is_historical IS NULL OR is_historical = 0) AND status != 'cancelled'
          UNION ALL
         SELECT so.sales_channel, CONCAT(so.native_checkout_id, '-so-', so.id), so.shopify_order_id, so.shopify_order_name,
                CASE WHEN sop.notes LIKE 'Native Store Credit %' THEN 'store_credit' ELSE 'stripe' END,
                sop.amount, 0
           FROM ims_sales_orders so
           JOIN ims_sales_order_payments sop ON sop.so_id = so.id AND sop.business_id = so.business_id
          WHERE so.business_id = ? AND DATE_FORMAT(so.order_date, '%Y-%m-%d') = ?
            AND so.so_type = 'online' AND so.sales_channel = 'native_shop'
            AND COALESCE(so.is_staff_preview_test, 0) = 0
            AND (so.is_historical IS NULL OR so.is_historical = 0) AND so.status != 'cancelled'`,
        [businessId, date, businessId, date],
      ),
      query<OnlineGatewayMapping>(
        `SELECT gateway_name, clearing_account_code, fee_account_code, fee_tax_type,
                deduct_fee_enabled, fixed_fee_amount, percentage_fee_rate
           FROM xero_gateway_mappings
          WHERE business_id = ?
          UNION ALL
         SELECT 'store_credit', xero_account_code, NULL, 'NONE', 0, 0, 0
           FROM xero_account_mappings
          WHERE business_id = ? AND role_key = 'store_credit_liability' AND xero_account_code IS NOT NULL`,
        [businessId, businessId],
      ).catch(() => []),
    ]);

    const totalSales = Number(totals[0]?.total_sales ?? 0);
    const totalTax = Number(totals[0]?.total_tax ?? 0);
    const giftCardAmount = Number(totals[0]?.gift_card_amount ?? 0);
    const orderCount = Number(totals[0]?.order_count ?? 0);
    if (!(totalSales > 0)) {
      return { xeroId: null, totalSales, totalTax, giftCardAmount, orderCount };
    }
    if (policy.onlineBatchAction === 'none') {
      return { xeroId: null, totalSales, totalTax, giftCardAmount, orderCount };
    }

    const paymentRows = gatewayRows
      .map(row => {
        const gateway = normalizeOnlineGateway(row.gateway);
        const amount = Math.round(Number(row.total_sales) * 100) / 100;
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

    const missingMappings = policy.onlineBatchPaymentSyncEnabled
      ? paymentRows.filter(row => !row.payoutManaged && !row.accountCode)
      : [];
    if (gatewayMappings.length > 0 && missingMappings.length > 0) {
      throw new Error(`Missing gateway clearing mapping for: ${missingMappings.map(row => row.gateway).join(', ')}`);
    }

    const clearingPayments = policy.onlineBatchPaymentSyncEnabled ? paymentRows
      .filter(row => !row.payoutManaged && !isPayPalGateway(row.gateway)
        && !hasCalculatedFees(row.gateway, findOnlineGatewayMapping(row.gateway, gatewayMappings))
        && !!row.accountCode)
      .map(row => ({
        accountCode: row.accountCode as string,
        amount: row.amount,
        label: row.gateway === '_unknown' ? 'Unknown' : row.gateway,
      })) : [];
    const feeEnabledPayments = policy.onlineBatchPaymentSyncEnabled ? orderRows
      .map(row => {
        const gateway = normalizeOnlineGateway(row.payment_gateway);
        const mapping = findOnlineGatewayMapping(gateway, gatewayMappings);
        if (!hasCalculatedFees(gateway, mapping) || !mapping?.clearing_account_code || !mapping.fee_account_code) return null;
        const identity = getOnlineBatchOrderIdentity(row);
        const amount = Math.round(Number(row.total_amount) * 100) / 100;
        if (!identity || !(amount > 0)) return null;
        const feeAmount = calculateGatewayFee(
          amount,
          Number(mapping.fixed_fee_amount ?? 0),
          Number(mapping.percentage_fee_rate ?? 0),
        );
        return {
          accountCode: mapping.clearing_account_code,
          amount,
          label: gateway,
          paymentKey: `gateway-order-${identity.id}`,
          reference: `${mapping.gateway_name} ${identity.reference}`,
          ...(feeAmount > 0 ? {
            fee: {
              amount: feeAmount,
              gatewayName: mapping.gateway_name,
              accountCode: mapping.fee_account_code,
              taxType: mapping.fee_tax_type === 'INPUT' ? 'INPUT' : 'NONE',
            },
          } : {}),
        };
      })
      .filter((payment): payment is NonNullable<typeof payment> => !!payment) : [];
    const paypalOrderRows = orderRows.filter(row => isPayPalGateway(String(row.payment_gateway ?? '')));
    const paypalOrdersMissingIds = paypalOrderRows.filter(row => !getOnlineBatchOrderIdentity(row));
    if (paypalOrdersMissingIds.length > 0) {
      throw new Error(`${paypalOrdersMissingIds.length} PayPal order(s) have no stable online order ID and cannot be posted safely`);
    }
    const paypalPayments = policy.onlineBatchPaymentSyncEnabled ? paypalOrderRows
      .map(row => {
        const gateway = normalizeOnlineGateway(row.payment_gateway);
        const accountCode = findOnlineGatewayClearingAccount(gateway, gatewayMappings);
        const identity = getOnlineBatchOrderIdentity(row);
        const amount = Math.round(Number(row.total_amount) * 100) / 100;
        if (!accountCode || !identity || !(amount > 0)) return null;
        return {
          accountCode,
          amount,
          label: gateway,
          paymentKey: `paypal-order-${identity.id}`,
          reference: `PayPal ${identity.reference}`,
        };
      })
      .filter((payment): payment is NonNullable<typeof payment> => !!payment) : [];
    clearingPayments.push(...feeEnabledPayments, ...paypalPayments);
    const deferredShopifyTotal = paymentRows
      .filter(row => row.payoutManaged)
      .reduce((sum, row) => sum + row.amount, 0);
    const targetTotal = Math.round(totalSales * 100) / 100;
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
      totalSales: Math.round((totalSales - totalTax) * 100) / 100,
      totalTax,
      lineDescription: `Online Sales ${date} (${orderCount} orders)`,
      ...(clearingPayments.length > 0 ? { clearingPayments } : {}),
      payoutManaged: deferredShopifyTotal > 0,
      gatewayAllocations: paymentRows.map(row => ({
        gateway: row.gateway,
        amount: row.amount,
        payoutManaged: row.payoutManaged,
      })),
      invoiceStatus: policy.onlineBatchAction === 'draft' ? 'DRAFT' : 'AUTHORISED',
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