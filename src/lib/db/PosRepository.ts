import { imsQuery, imsExecute, getIMSPool } from '@/services/IMSMySQLService';
import { getPosStockQtyChange } from '@/lib/ims/posReturnCreditNote';
import { unwindGiftCardTransactionsForSale, type GiftCardVoidReversal } from '@/lib/pos/giftCardSaleVoid';
import {
  LoyaltyRepository,
  LoyaltyEditBlockedError,
  LoyaltyValidationError,
  LoyaltyVoidBlockedError,
  type LoyaltyPosSaleReversalResult,
} from '@/lib/ims/LoyaltyRepository';
import { calculateEarnedPoints, calculatePosEligibleSpend, calculatePosReturnEligibleCents } from '@/lib/loyalty/calculations';
import { ShopifyLoyaltyMetafieldService } from '@/lib/loyalty/ShopifyLoyaltyMetafieldService';
import { LOYALTY_SETTING_KEYS, type LoyaltyMutationResult, type LoyaltyRedemptionResult } from '@/lib/loyalty/types';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { planPosStockChange } from '@/lib/ims/posStockFloor';

/** Current datetime formatted as MySQL DATETIME in the business's local timezone. */
function localNow(): string {
  const tz = process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney';
  return new Date().toLocaleString('sv-SE', { timeZone: tz }).replace('T', ' ');
}

export type PosStockWarning = {
  variantId: string;
  itemName: string;
  previousOnHand: number;
  resultingOnHand: number;
  uncappedResultingOnHand: number;
  automaticAdjustmentQuantity: number;
  quantityCommitted: number;
  incomingTransferQuantity?: number;
  reason: 'negative_stock' | 'committed_stock_at_risk' | 'incoming_transfer_stock';
};

async function applyPosStockMovementWithFloor(connection: any, input: {
  businessId: string;
  variantId: string;
  locationId: number;
  saleId: number;
  currentOnHand: number;
  requestedChange: number;
  minimumOnHand?: number;
  averageCost: number;
  hasStockRow: boolean;
  movementNote?: string | null;
}) {
  const plan = planPosStockChange(input.currentOnHand, input.requestedChange, input.minimumOnHand);
  if (plan.automaticAdjustmentQuantity > 0) {
    if (input.hasStockRow) {
      await connection.execute(
        `UPDATE ims_stock SET qty_on_hand = ? WHERE variant_id = ? AND location_id = ?`,
        [plan.afterAdjustmentOnHand, input.variantId, input.locationId],
      );
    } else {
      await connection.execute(
        `INSERT INTO ims_stock (business_id, variant_id, location_id, qty_on_hand) VALUES (?, ?, ?, ?)`,
        [input.businessId, input.variantId, input.locationId, plan.afterAdjustmentOnHand],
      );
    }
    await connection.execute(
      `INSERT INTO ims_stock_movements
         (business_id, variant_id, location_id, movement_type, channel, reference_type, reference_id,
          qty_change, qty_after_soh, unit_cost, notes)
       VALUES (?, ?, ?, 'adjustment', 'pos', 'pos_sale', ?, ?, ?, ?, ?)`,
      [input.businessId, input.variantId, input.locationId, input.saleId, plan.automaticAdjustmentQuantity,
        plan.afterAdjustmentOnHand, input.averageCost, 'Automatic correction: POS transaction exceeded recorded stock on hand'],
    );
  }

  if (input.hasStockRow || plan.automaticAdjustmentQuantity > 0) {
    await connection.execute(
      `UPDATE ims_stock SET qty_on_hand = ? WHERE variant_id = ? AND location_id = ?`,
      [plan.resultingOnHand, input.variantId, input.locationId],
    );
  } else {
    await connection.execute(
      `INSERT INTO ims_stock (business_id, variant_id, location_id, qty_on_hand) VALUES (?, ?, ?, ?)`,
      [input.businessId, input.variantId, input.locationId, plan.resultingOnHand],
    );
  }

  await connection.execute(
    `INSERT INTO ims_stock_movements
       (business_id, variant_id, location_id, movement_type, channel, reference_type, reference_id,
        qty_change, qty_after_soh, unit_cost, notes)
     VALUES (?, ?, ?, 'pos_sale', 'pos', 'pos_sale', ?, ?, ?, ?, ?)`,
    [input.businessId, input.variantId, input.locationId, input.saleId, plan.requestedChange,
      plan.resultingOnHand, input.averageCost, input.movementNote ?? null],
  );
  return plan;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PosSaleRow {
  id:                number;
  business_id:       string;
  local_id:          string | null;
  register_id:       number | null;
  register_session_id: number | null;
  location_id:       number;
  cashier_id:        number;
  cashier_name:      string | null;
  sale_type:         'sale' | 'return' | 'layby';
  status:            'open' | 'parked' | 'completed' | 'voided' | 'layby_active' | 'layby_complete';
  customer_id:       number | null;
  credit_note_id:    number | null;
  customer_name:     string | null;
  customer_phone:    string | null;
  subtotal:          number;
  discount_total:    number;
  tax_total:         number;
  total:             number;
  cash_rounding?:    number;
  loyalty_earn_rate: number | null;
  notes:             string | null;
  parked_label:      string | null;
  return_of_sale_id: number | null;
  created_at:        string;
  completed_at:      string | null;
}

export interface PosSaleItemRow {
  id:              number;
  sale_id:         number;
  return_of_sale_item_id: number | null;
  is_gift_card:    number;
  returned_qty?:   number;
  variant_id:      string | null;
  code:            string | null;
  name:            string;
  qty:             number;
  unit_price:      number;
  original_price:  number | null;
  discount_type:   'none' | 'percent' | 'amount';
  discount_value:  number;
  discount_amount: number;
  tax_rate:        number;
  line_total:      number;
}

export interface PosPaymentRow {
  id:             number;
  sale_id:        number;
  payment_method: string;
  amount:         number;
  reference:      string | null;
  created_at:     string;
}

export interface PosEodRow {
  id:                number;
  location_id:       number;
  register_id:       number | null;
  register_session_id?: number | null;
  cashier_id:        number;
  recon_date:        string;
  payment_method:    string;
  expected_amount:   number | null;
  counted_amount:    number | null;
  opening_float:     number | null;
  denomination_data: Record<string, number> | null;
  notes:             string | null;
  xero_invoice_id?:  string | null;
  xero_synced_at?:   string | null;
  xero_payment_required?: number;
  xero_payment_id?: string | null;
  xero_payment_synced_at?: string | null;
  xero_payment_error?: string | null;
  xero_clearing_account_code?: string | null;
  created_at:        string;
}

export interface PosRegisterRow {
  id:            number;
  location_id:   number;
  name:          string;
  default_float: number;
  is_active:     number;
  created_at:    string;
  // Card terminal
  card_terminal_provider: string | null;
  zeller_site_id:         string | null;
  zeller_terminal_id:     string | null;
  zeller_api_key:         string | null;
  card_terminal_methods:  string | null;  // JSON array e.g. '["Card","EFTPOS"]'
}

export interface PosRegisterSessionRow {
  id:               number;
  register_id:      number;
  location_id:      number;
  session_date:     string;
  opened_at:        string;
  closed_at:        string | null;
  opened_by:        string | null;
  closed_by:        string | null;
  opening_float:    number | null;
  denomination_data: Record<string, number> | null;
  status:           'open' | 'closed';
}

// ─── Helper: coerce mysql2 decimals ──────────────────────────────────────────

function toNum(v: unknown): number {
  return v == null ? 0 : Number(v);
}

function parseSale(row: any): PosSaleRow {
  return {
    ...row,
    subtotal:       toNum(row.subtotal),
    discount_total: toNum(row.discount_total),
    tax_total:      toNum(row.tax_total),
    total:          toNum(row.total),
  };
}

function parseItem(row: any): PosSaleItemRow {
  return {
    ...row,
    qty:             toNum(row.qty),
    unit_price:      toNum(row.unit_price),
    original_price:  row.original_price != null ? toNum(row.original_price) : null,
    discount_value:  toNum(row.discount_value),
    discount_amount: toNum(row.discount_amount),
    tax_rate:        toNum(row.tax_rate),
    line_total:      toNum(row.line_total),
  };
}

function parsePayment(row: any): PosPaymentRow {
  return { ...row, amount: toNum(row.amount) };
}

// ─── POS Sales Repository ─────────────────────────────────────────────────────

export const PosSalesRepo = {
  async get(id: number): Promise<{ sale: PosSaleRow; items: PosSaleItemRow[]; payments: PosPaymentRow[] } | null> {
    const sales = await imsQuery<any>('SELECT * FROM pos_sales WHERE id = ? LIMIT 1', [id]);
    if (!sales[0]) return null;
    const sale = parseSale(sales[0]);
    const items = (await imsQuery<any>(
      `SELECT i.*,
              COALESCE((
                SELECT SUM(ABS(ri.qty))
                  FROM pos_sale_items ri
                  JOIN pos_sales rs ON rs.id = ri.sale_id
                 WHERE ri.return_of_sale_item_id = i.id
                   AND rs.sale_type = 'return' AND rs.status = 'completed'
              ), 0) AS returned_qty
         FROM pos_sale_items i
        WHERE i.sale_id = ?`,
      [id],
    )).map(parseItem);
    const payments = (await imsQuery<any>('SELECT * FROM pos_payments WHERE sale_id = ? ORDER BY created_at', [id])).map(parsePayment);
    return { sale, items, payments };
  },

  async findByLocalId(localId: string): Promise<PosSaleRow | null> {
    const rows = await imsQuery<any>('SELECT * FROM pos_sales WHERE local_id = ? LIMIT 1', [localId]);
    return rows[0] ? parseSale(rows[0]) : null;
  },

  async list(locationId: number, date: string): Promise<PosSaleRow[]> {
    // date: 'YYYY-MM-DD'
    const rows = await imsQuery<any>(
      `SELECT * FROM pos_sales
       WHERE location_id = ? AND DATE(created_at) = ?
       ORDER BY created_at DESC`,
      [locationId, date],
    );
    return rows.map(parseSale);
  },

  async listParked(locationId: number): Promise<PosSaleRow[]> {
    const rows = await imsQuery<any>(
      `SELECT * FROM pos_sales WHERE location_id = ? AND status IN ('parked','layby_active')
       ORDER BY created_at DESC`,
      [locationId],
    );
    return rows.map(parseSale);
  },

  /**
   * Complete a sale in a single transaction:
   * 1. INSERT pos_sales
   * 2. INSERT pos_sale_items
   * 3. INSERT pos_payments
   * 4. Deduct IMS stock for items that have a variant_id
   * Returns the new sale id.
   */
  async complete(data: {
    business_id:       string;
    local_id:          string | null;
    register_id:       number | null;
    register_session_id?: number | null;
    location_id:       number;
    cashier_id:        number | null;
    cashier_name:      string | null;
    sale_type:         'sale' | 'return' | 'layby';
    status:            'completed' | 'layby_active' | 'layby_complete' | 'parked' | 'voided';
    customer_id?:      number | null;
    customer_name?:    string | null;
    customer_phone?:   string | null;
    loyalty_reward_id?: number | null;
    loyalty_discount_total?: number;
    subtotal:          number;
    discount_total:    number;
    tax_total:         number;
    total:             number;
    cash_rounding?:    number;
    notes?:            string | null;
    parked_label?:     string | null;
    return_of_sale_id?: number | null;
    allow_incoming_transfer_sales?: boolean;
    items: Array<{
      return_of_sale_item_id?: number | null;
      variant_id:      string | null;
      code:            string | null;
      name:            string;
      qty:             number;
      unit_price:      number;
      original_price?: number | null;
      discount_type:   'none' | 'percent' | 'amount';
      discount_value:  number;
      discount_amount: number;
      tax_rate:        number;
      line_total:      number;
      is_gift_card?:   boolean;
    }>;
    payments: Array<{
      payment_method: string;
      amount:         number;
      reference?:     string | null;
    }>;
  }): Promise<{
    saleId: number;
    stockError: string | undefined;
    stockWarnings: PosStockWarning[];
    loyalty: LoyaltyMutationResult | null;
    loyaltyPoints: number;
    loyaltyRedemption: LoyaltyRedemptionResult | null;
  }> {
    const pool = getIMSPool();
    const conn = await pool.getConnection();
    let loyaltyWriteAttempted = false;
    let loyalty: LoyaltyMutationResult | null = null;
    let loyaltyPoints = 0;
    let loyaltyRedemption: LoyaltyRedemptionResult | null = null;
    try {
      await conn.beginTransaction();

      const now = localNow();
      const completedAt = ['completed', 'layby_complete', 'voided'].includes(data.status) ? now : null;
      let linkedReturnAllocation: { originalEligibleCents: number; cumulativeReturnedCents: number } | null = null;

      if (data.sale_type === 'return' && data.status === 'completed' && data.return_of_sale_id != null) {
        const originalSaleId = Number(data.return_of_sale_id);
        if (!Number.isInteger(originalSaleId) || originalSaleId <= 0) throw new LoyaltyValidationError('A valid original sale is required for a linked return.');
        const [originalSales] = await conn.execute<any[]>(
          `SELECT id, customer_id, discount_total, total
             FROM pos_sales
            WHERE id = ? AND business_id = ? AND sale_type = 'sale' AND status = 'completed'
            LIMIT 1
            FOR UPDATE`,
          [originalSaleId, data.business_id],
        );
        const originalSale = originalSales[0];
        if (!originalSale) throw new LoyaltyValidationError('The original completed sale could not be found.');
        if (data.customer_id != null && Number(data.customer_id) !== Number(originalSale.customer_id)) {
          throw new LoyaltyValidationError('The return customer must match the original sale customer.');
        }

        const [originalItems] = await conn.execute<any[]>(
          `SELECT id, variant_id, qty, line_total, discount_amount, is_gift_card
             FROM pos_sale_items
            WHERE sale_id = ?
            ORDER BY id
            FOR UPDATE`,
          [originalSaleId],
        );
        const originalById = new Map<number, any>(originalItems.map(item => [Number(item.id), item]));
        const originalLineTotal = originalItems.reduce((sum, item) => sum + Math.max(0, Number(item.line_total)), 0);
        if (originalLineTotal <= 0) throw new LoyaltyValidationError('The original sale has no refundable value.');
        const netSaleRatio = Math.max(0, Number(originalSale.total)) / originalLineTotal;
        const [priorReturnRows] = await conn.execute<any[]>(
          `SELECT ri.return_of_sale_item_id, ri.qty
             FROM pos_sale_items ri
             JOIN pos_sales rs ON rs.id = ri.sale_id
            WHERE rs.business_id = ? AND rs.sale_type = 'return' AND rs.status = 'completed'
              AND rs.return_of_sale_id = ? AND ri.return_of_sale_item_id IS NOT NULL
            ORDER BY ri.id
            FOR UPDATE`,
          [data.business_id, originalSaleId],
        );
        const cumulativeReturnedQtyByItemId = new Map<number, number>();
        for (const row of priorReturnRows) {
          const sourceItemId = Number(row.return_of_sale_item_id);
          cumulativeReturnedQtyByItemId.set(
            sourceItemId,
            Number(cumulativeReturnedQtyByItemId.get(sourceItemId) ?? 0) + Math.abs(Number(row.qty)),
          );
        }
        let expectedReturnTotal = 0;
        for (const item of data.items) {
          const sourceItemId = Number(item.return_of_sale_item_id);
          const originalItem = originalById.get(sourceItemId);
          if (!Number.isInteger(sourceItemId) || !originalItem) throw new LoyaltyValidationError('Every linked return line must reference an original sale line.');
          const returnQty = Math.abs(Number(item.qty));
          if (!Number.isFinite(returnQty) || returnQty <= 0 || Number(item.qty) >= 0) throw new LoyaltyValidationError('Linked return quantities must be negative.');
          if ((item.variant_id ?? null) !== (originalItem.variant_id ?? null)) throw new LoyaltyValidationError('A linked return item does not match its original sale line.');
          const cumulativeQty = Number(cumulativeReturnedQtyByItemId.get(sourceItemId) ?? 0) + returnQty;
          if (cumulativeQty > Number(originalItem.qty) + 0.000001) throw new LoyaltyValidationError('A linked return quantity exceeds the remaining quantity sold.');
          const expectedLineTotal = -Math.round(
            Number(originalItem.line_total) * netSaleRatio * returnQty / Number(originalItem.qty) * 100,
          ) / 100;
          if (Math.abs(Number(item.line_total) - expectedLineTotal) > 0.011 || Math.abs(Number(item.discount_amount)) > 0.001) {
            throw new LoyaltyValidationError('Linked return values must match the original sale after discounts.');
          }
          expectedReturnTotal += expectedLineTotal;
          cumulativeReturnedQtyByItemId.set(sourceItemId, cumulativeQty);
        }
        expectedReturnTotal = Math.round(expectedReturnTotal * 100) / 100;
        if (Math.abs(Number(data.total) - expectedReturnTotal) > 0.011 || Math.abs(Number(data.discount_total)) > 0.001) {
          throw new LoyaltyValidationError('The linked return total must match the original sale value.');
        }
        linkedReturnAllocation = calculatePosReturnEligibleCents({
          originalItems: originalItems.map(item => ({
            id: Number(item.id),
            qty: Number(item.qty),
            lineTotal: Number(item.line_total),
            discountAmount: Number(item.discount_amount),
            isGiftCard: Boolean(item.is_gift_card),
          })),
          originalDiscountTotal: Number(originalSale.discount_total),
          cumulativeReturnedQtyByItemId,
        });
      }

      // 1. Insert sale
      const [saleResult]: any = await conn.execute(
        `INSERT INTO pos_sales
          (business_id, local_id, register_id, register_session_id, location_id, cashier_id, cashier_name, sale_type, status,
          customer_id, customer_name, customer_phone, subtotal, discount_total,
            tax_total, total, cash_rounding, notes, parked_label, return_of_sale_id, completed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
         data.business_id,
          data.local_id ?? null,
          data.register_id ?? null,
          data.register_session_id ?? null,
          data.location_id,
          data.cashier_id,
          data.cashier_name ?? null,
          data.sale_type,
          data.status,
          data.customer_id ?? null,
          data.customer_name ?? null,
          data.customer_phone ?? null,
          data.subtotal,
          data.discount_total,
          data.tax_total,
          data.total,
          data.cash_rounding ?? 0,
          data.notes ?? null,
          data.parked_label ?? null,
          data.return_of_sale_id ?? null,
          completedAt,
          now,
        ],
      );
      const saleId: number = saleResult.insertId;

      // 2. Insert items
      for (const item of data.items) {
        await conn.execute(
          `INSERT INTO pos_sale_items
             (business_id, sale_id, return_of_sale_item_id, is_gift_card, variant_id, code, name, qty, unit_price, original_price,
              discount_type, discount_value, discount_amount, tax_rate, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            data.business_id,
            saleId,
            item.return_of_sale_item_id ?? null,
            item.is_gift_card ? 1 : 0,
            item.variant_id ?? null,
            item.code ?? null,
            item.name,
            item.qty,
            item.unit_price,
            item.original_price ?? null,
            item.discount_type,
            item.discount_value,
            item.discount_amount,
            item.tax_rate,
            item.line_total,
          ],
        );
      }

      // 3. Insert payments
      for (const pmt of data.payments) {
        await conn.execute(
          `INSERT INTO pos_payments (sale_id, payment_method, amount, reference)
           VALUES (?, ?, ?, ?)`,
          [saleId, pmt.payment_method, pmt.amount, pmt.reference ?? null],
        );
      }

      if (linkedReturnAllocation && data.return_of_sale_id != null) {
        loyaltyWriteAttempted = true;
        loyalty = await LoyaltyRepository.reversePosReturn(conn, {
          businessId: data.business_id,
          originalSaleId: Number(data.return_of_sale_id),
          returnSaleId: saleId,
          originalEligibleCents: linkedReturnAllocation.originalEligibleCents,
          cumulativeReturnedCents: linkedReturnAllocation.cumulativeReturnedCents,
          actorId: data.cashier_id,
        });
      }

      let loyaltyEnabled = false;
      let loyaltyStartedAt = '';
      let loyaltyEarnRate = 1;
      if (data.sale_type === 'sale' && data.status === 'completed' && data.customer_id) {
        const [settingRows] = await conn.execute<any[]>(
          `SELECT \`key\`, value
             FROM ims_settings
            WHERE business_id = ? AND \`key\` IN (?, ?, ?)`,
          [data.business_id, LOYALTY_SETTING_KEYS.enabled, LOYALTY_SETTING_KEYS.earnRate, LOYALTY_SETTING_KEYS.startedAt],
        );
        const loyaltySettings = Object.fromEntries(settingRows.map(row => [String(row.key), String(row.value ?? '')]));
        loyaltyEnabled = loyaltySettings[LOYALTY_SETTING_KEYS.enabled] === '1';
        loyaltyStartedAt = loyaltySettings[LOYALTY_SETTING_KEYS.startedAt] || '';
        loyaltyEarnRate = Number(loyaltySettings[LOYALTY_SETTING_KEYS.earnRate] || 1);
      }

      if (data.loyalty_reward_id != null) {
        loyaltyWriteAttempted = true;
        if (data.sale_type !== 'sale' || data.status !== 'completed' || !data.customer_id) {
          throw new LoyaltyValidationError('Loyalty rewards require a completed customer sale.');
        }
        if (!loyaltyEnabled || (loyaltyStartedAt && now.slice(0, 10) < loyaltyStartedAt)) {
          throw new LoyaltyValidationError('The loyalty program is not active.');
        }
        const loyaltyDiscount = Number(data.loyalty_discount_total ?? 0);
        if (!Number.isFinite(loyaltyDiscount) || loyaltyDiscount <= 0) throw new LoyaltyValidationError('The loyalty discount is invalid.');
        const eligibleBeforeReward = calculatePosEligibleSpend({
          items: data.items.map(item => ({
            lineTotal: Number(item.line_total),
            discountAmount: Number(item.discount_amount),
            isGiftCard: Boolean(item.is_gift_card),
          })),
          discountTotal: Math.max(0, Number(data.discount_total) - loyaltyDiscount),
        });
        loyaltyRedemption = await LoyaltyRepository.reserveReward(conn, {
          businessId: data.business_id,
          contactId: data.customer_id,
          rewardId: data.loyalty_reward_id,
          idempotencyKey: `pos:sale:${saleId}:reward:${data.loyalty_reward_id}`,
          channel: 'pos',
          actorId: data.cashier_id,
          posSaleId: saleId,
        });
        if (Math.abs(loyaltyRedemption.rewardValueAud - loyaltyDiscount) > 0.001) {
          throw new LoyaltyValidationError('The loyalty reward value does not match the sale discount.');
        }
        if (eligibleBeforeReward + 0.001 < loyaltyRedemption.rewardValueAud) {
          throw new LoyaltyValidationError('Eligible merchandise must cover the full loyalty reward value.');
        }
        if (Math.abs(Number(data.total) - (Number(data.subtotal) - Number(data.discount_total))) > 0.011) {
          throw new LoyaltyValidationError('The sale total does not match its discounts.');
        }
        if (Math.abs(Number(data.tax_total) - Number(data.total) / 11) > 0.011) {
          throw new LoyaltyValidationError('The sale tax does not match its loyalty-adjusted total.');
        }
      }

      if (data.sale_type === 'sale' && data.status === 'completed' && data.customer_id) {
        if (loyaltyEnabled && (!loyaltyStartedAt || now.slice(0, 10) >= loyaltyStartedAt)) {
          await conn.execute(
            'UPDATE pos_sales SET loyalty_earn_rate = ? WHERE id = ? AND business_id = ?',
            [loyaltyEarnRate, saleId, data.business_id],
          );
          const [contactRows] = await conn.execute<any[]>(
            `SELECT id
               FROM ims_contacts
              WHERE id = ? AND business_id = ? AND is_active = 1 AND loyalty_member = 1
                AND type IN ('retail_customer','b2b_customer','both')
              LIMIT 1`,
            [data.customer_id, data.business_id],
          );
          if (contactRows[0]) {
            const eligibleSpend = calculatePosEligibleSpend({
              items: data.items.map(item => ({
                lineTotal: Number(item.line_total),
                discountAmount: Number(item.discount_amount),
                isGiftCard: Boolean(item.is_gift_card),
              })),
              discountTotal: Number(data.discount_total),
            });
            loyaltyPoints = calculateEarnedPoints({ merchandiseTotal: eligibleSpend, earnRate: loyaltyEarnRate });
            if (loyaltyPoints > 0) {
              loyaltyWriteAttempted = true;
              loyalty = await LoyaltyRepository.applyTransaction(conn, {
                businessId: data.business_id,
                contactId: data.customer_id,
                type: 'earn',
                pointsDelta: loyaltyPoints,
                channel: 'pos',
                sourceType: 'pos_sale',
                sourceId: saleId,
                idempotencyKey: `pos:sale:${saleId}:earn`,
                actorId: data.cashier_id,
              });
            }
          }
        }
      }

      await conn.commit();

      // 4. Deduct IMS stock AFTER the sale transaction has committed.
      //    Separated so a stock failure (e.g. unsynced variant FK error) never
      //    causes the sale itself to roll back and re-queue.
      //    Returns stockError string if deduction failed — API returns success
      //    anyway so the client clears the queue, but logs the issue.
      let stockError: string | undefined;
      const stockWarnings: PosStockWarning[] = [];
      if (data.status === 'completed' || data.status === 'layby_complete') {
        const pool = getIMSPool();
        const stockConn = await pool.getConnection();
        try {
          await stockConn.beginTransaction();
          for (const item of data.items) {
            if (!item.variant_id) continue;
            const qtyChange = getPosStockQtyChange(Number(item.qty), data.sale_type);
            if (qtyChange === null) continue;
            const [stockRows]: any = await stockConn.execute(
                  `SELECT s.variant_id AS stock_variant_id, s.qty_on_hand, s.qty_committed, COALESCE(pv.avg_cost, 0) AS avg_cost,
                      COALESCE(p.is_stock_item, 1) AS is_stock_item
               FROM ims_product_variants pv
               JOIN ims_products p ON p.product_id = pv.product_id
               LEFT JOIN ims_stock s ON s.variant_id = pv.variant_id AND s.location_id = ?
               WHERE pv.variant_id = ? LIMIT 1
               FOR UPDATE`,
              [data.location_id, item.variant_id],
            );
            if (Number(stockRows[0]?.is_stock_item ?? 1) === 0) continue;
            const currentSoh = Number(stockRows[0]?.qty_on_hand ?? 0);
            const quantityCommitted = Number(stockRows[0]?.qty_committed ?? 0);
            const avgCostAtTime = Number(stockRows[0]?.avg_cost ?? 0);
            let incomingTransferQuantity = 0;
            if (data.allow_incoming_transfer_sales === true && qtyChange < 0 && currentSoh + qtyChange < 0) {
              const [incomingRows]: any = await stockConn.execute(
                `SELECT COALESCE(SUM(GREATEST(bti.qty_sent - COALESCE(bti.qty_received, 0), 0)), 0) AS incoming_quantity
                   FROM ims_branch_transfers bt
                   JOIN ims_branch_transfer_items bti ON bti.transfer_id = bt.id
                  WHERE bt.business_id = ? AND bt.to_location_id = ?
                    AND bt.status IN ('sent', 'partial') AND bti.variant_id = ?`,
                [data.business_id, data.location_id, item.variant_id],
              );
              incomingTransferQuantity = Math.max(0, Number(incomingRows[0]?.incoming_quantity ?? 0));
            }
            const stockPlan = planPosStockChange(currentSoh, qtyChange, -incomingTransferQuantity);
            if (qtyChange < 0 && (stockPlan.uncappedResultingOnHand < 0 || stockPlan.resultingOnHand < quantityCommitted)) {
              const usesIncomingTransferStock = stockPlan.resultingOnHand < 0 && incomingTransferQuantity > 0;
              stockWarnings.push({
                variantId: item.variant_id,
                itemName: item.name,
                previousOnHand: currentSoh,
                resultingOnHand: stockPlan.resultingOnHand,
                uncappedResultingOnHand: stockPlan.uncappedResultingOnHand,
                automaticAdjustmentQuantity: stockPlan.automaticAdjustmentQuantity,
                quantityCommitted,
                ...(incomingTransferQuantity > 0 ? { incomingTransferQuantity } : {}),
                reason: usesIncomingTransferStock
                  ? 'incoming_transfer_stock'
                  : stockPlan.uncappedResultingOnHand < 0 ? 'negative_stock' : 'committed_stock_at_risk',
              });
              if (stockPlan.resultingOnHand < quantityCommitted) {
                await stockConn.execute(
                  `UPDATE ims_stock_allocations
                      SET promise_status = CASE WHEN promise_status = 'confirmed' THEN 'at_risk' ELSE promise_status END,
                          risk_reason = 'POS sale reduced stock below confirmed customer demand.',
                          revision = revision + 1
                    WHERE business_id = ? AND variant_id = ? AND location_id = ? AND state = 'active'
                      AND qty_received_assigned > qty_fulfilled`,
                  [data.business_id, item.variant_id, data.location_id],
                );
              }
            }

            const hasStockRow = Boolean(stockRows[0]?.stock_variant_id);
            await applyPosStockMovementWithFloor(stockConn, {
              businessId: data.business_id,
              variantId: item.variant_id,
              locationId: data.location_id,
              saleId,
              currentOnHand: currentSoh,
              requestedChange: qtyChange,
              averageCost: avgCostAtTime,
              hasStockRow,
              minimumOnHand: -incomingTransferQuantity,
            });
          }
          const incomingStockWarnings = stockWarnings.filter(warning => warning.reason === 'incoming_transfer_stock');
          if (incomingStockWarnings.length > 0) {
            const itemNames = incomingStockWarnings.map(warning => warning.itemName).slice(0, 3).join(', ');
            await stockConn.execute(
              `INSERT INTO ims_notifications (business_id, type, source, title, message, detail)
               VALUES (?, 'warning', 'pos_incoming_stock', 'POS sale used incoming transfer stock', ?, ?)`,
              [data.business_id,
                `Sale #${saleId} sold ${itemNames || 'stock'} before its branch transfer was received. Complete the transfer receipt and verify location stock.`,
                JSON.stringify({ sale_id: saleId, location_id: data.location_id, warnings: incomingStockWarnings })],
            );
          }
          await stockConn.commit();
        } catch (stockErr: any) {
          await stockConn.rollback();
          stockError = stockErr?.message || String(stockErr);
          console.error(`[POS] Sale ${saleId} saved but stock deduction failed:`, stockErr);
        } finally {
          stockConn.release();
        }
      }

      if (loyaltyWriteAttempted && data.customer_id) {
        await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({
          businessId: data.business_id,
          contactId: data.customer_id,
        });
      }

      return { saleId, stockError, stockWarnings, loyalty, loyaltyPoints, loyaltyRedemption };
    } catch (err) {
      await conn.rollback();
      if (loyaltyWriteAttempted && !(err instanceof LoyaltyValidationError)) {
        await reportRuntimeIssue({
          businessId: data.business_id,
          source: 'pos_loyalty',
          operation: 'process_sale_loyalty',
          title: 'POS sale loyalty processing failed',
          error: err,
          context: {
            localId: data.local_id,
            customerId: data.customer_id,
            locationId: data.location_id,
            points: Number.isFinite(loyaltyPoints) ? loyaltyPoints : null,
            rewardId: data.loyalty_reward_id ?? null,
          },
          reference: data.local_id ? { type: 'pos_sale_local_id', id: data.local_id } : undefined,
        });
      }
      throw err;
    } finally {
      conn.release();
    }
  },

  async linkCreditNote(saleId: number, creditNoteId: number, businessId: string): Promise<void> {
    await imsExecute(
      `UPDATE pos_sales SET credit_note_id = ? WHERE id = ? AND business_id = ?`,
      [creditNoteId, saleId, businessId],
    );
  },

  async updateStatus(id: number, status: PosSaleRow['status'], extra?: { parked_label?: string }): Promise<void> {
    const completedAt = ['completed', 'layby_complete', 'voided'].includes(status)
      ? localNow()
      : null;
    if (extra?.parked_label !== undefined) {
      await imsExecute(
        'UPDATE pos_sales SET status = ?, parked_label = ?, completed_at = ? WHERE id = ?',
        [status, extra.parked_label, completedAt, id],
      );
    } else {
      await imsExecute(
        'UPDATE pos_sales SET status = ?, completed_at = ? WHERE id = ?',
        [status, completedAt, id],
      );
    }
  },

  async addPaymentToSale(saleId: number, payment: { payment_method: string; amount: number; reference?: string | null }): Promise<void> {
    await imsExecute(
      'INSERT INTO pos_payments (sale_id, payment_method, amount, reference) VALUES (?, ?, ?, ?)',
      [saleId, payment.payment_method, payment.amount, payment.reference ?? null],
    );
  },

  async updatePaymentSplit(
    saleId: number,
    payments: { payment_method: string; amount: number }[],
  ): Promise<void> {
    // Server-side guard: new amounts must sum to the original sale total (within 1 cent)
    const saleRows = await imsQuery<any>('SELECT total FROM pos_sales WHERE id = ? LIMIT 1', [saleId]);
    if (!saleRows[0]) throw new Error('Sale not found.');
    const originalTotal = toNum(saleRows[0].total);
    const newTotal = payments.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(newTotal - originalTotal) > 0.01) {
      throw new Error(`Payment total $${newTotal.toFixed(2)} does not match sale total $${originalTotal.toFixed(2)}.`);
    }
    if (payments.some(p => p.amount < 0)) throw new Error('Payment amounts cannot be negative.');
    // Replace all payments in a transaction
    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM pos_payments WHERE sale_id = ?', [saleId]);
      for (const p of payments) {
        await conn.execute(
          'INSERT INTO pos_payments (sale_id, payment_method, amount) VALUES (?, ?, ?)',
          [saleId, p.payment_method, p.amount],
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * Void a sale AND reverse the stock it deducted (or restore the return),
   * inserting an audit-trail movement row. `updateStatus('voided')` alone
   * does NOT touch stock — this is the version to use when a manager
   * actually wants stock corrected (e.g. deleting a mistaken transaction).
   */
  async voidWithReversal(id: number, actorId?: string | number | null): Promise<{
    stockError?: string;
    stockWarnings: PosStockWarning[];
    giftCardReversals: GiftCardVoidReversal[];
    loyaltyReversals?: LoyaltyPosSaleReversalResult;
  }> {
    const existing = await this.get(id);
    if (!existing) throw new Error('Sale not found.');
    const { sale, items } = existing;

    // Nothing was ever deducted for sales that never completed.
    if (!['completed', 'layby_complete'].includes(sale.status)) {
      await this.updateStatus(id, 'voided');
      return { giftCardReversals: [], stockWarnings: [] };
    }

    const pool = getIMSPool();
    const stockConn = await pool.getConnection();
    const stockWarnings: PosStockWarning[] = [];
    try {
      await stockConn.beginTransaction();
      const [saleRows]: any = await stockConn.execute(
        `SELECT status FROM pos_sales WHERE id = ? LIMIT 1 FOR UPDATE`,
        [id],
      );
      if (!saleRows[0]) throw new Error('Sale not found.');
      if (!['completed', 'layby_complete'].includes(saleRows[0].status)) {
        throw new Error(`Sale can no longer be voided from status ${saleRows[0].status}.`);
      }

      const giftCardReversals = await unwindGiftCardTransactionsForSale(stockConn, id);
      const loyaltyReversals = await LoyaltyRepository.reversePosSale(stockConn, {
        businessId: sale.business_id,
        saleId: id,
        actorId,
      });
      for (const item of items) {
        if (!item.variant_id) continue;
        // Opposite of the sign applied in complete(): a normal sale had
        // deducted -qty, so reversing adds +qty back; a return had added
        // +qty, so reversing subtracts it back out.
        const qtyChange = sale.sale_type === 'return' ? -item.qty : item.qty;
        const [stockRows]: any = await stockConn.execute(
            `SELECT s.variant_id AS stock_variant_id, s.qty_on_hand, COALESCE(pv.avg_cost, 0) AS avg_cost,
                  COALESCE(p.is_stock_item, 1) AS is_stock_item
           FROM ims_product_variants pv
           JOIN ims_products p ON p.product_id = pv.product_id
           LEFT JOIN ims_stock s ON s.variant_id = pv.variant_id AND s.location_id = ?
           WHERE pv.variant_id = ? LIMIT 1
           FOR UPDATE`,
          [sale.location_id, item.variant_id],
        );
        if (Number(stockRows[0]?.is_stock_item ?? 1) === 0) continue;
        const currentSoh = Number(stockRows[0]?.qty_on_hand ?? 0);
        const avgCostAtTime = Number(stockRows[0]?.avg_cost ?? 0);
        const stockPlan = await applyPosStockMovementWithFloor(stockConn, {
          businessId: sale.business_id,
          variantId: item.variant_id,
          locationId: sale.location_id,
          saleId: id,
          currentOnHand: currentSoh,
          requestedChange: qtyChange,
          averageCost: avgCostAtTime,
          hasStockRow: Boolean(stockRows[0]?.stock_variant_id),
          movementNote: 'Voided by manager PIN',
        });
        if (stockPlan.automaticAdjustmentQuantity > 0) {
          stockWarnings.push({
            variantId: item.variant_id,
            itemName: item.name,
            previousOnHand: currentSoh,
            resultingOnHand: stockPlan.resultingOnHand,
            uncappedResultingOnHand: stockPlan.uncappedResultingOnHand,
            automaticAdjustmentQuantity: stockPlan.automaticAdjustmentQuantity,
            quantityCommitted: 0,
            reason: 'negative_stock',
          });
        }
      }
      await stockConn.execute(
        `UPDATE pos_sales SET status = 'voided' WHERE id = ?`,
        [id],
      );
      await stockConn.commit();
      if (sale.customer_id) {
        await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({
          businessId: sale.business_id,
          contactId: sale.customer_id,
        });
      }
      return { giftCardReversals, loyaltyReversals, stockWarnings };
    } catch (err) {
      await stockConn.rollback();
      if (!(err instanceof LoyaltyValidationError) && !(err instanceof LoyaltyVoidBlockedError)) {
        await reportRuntimeIssue({
          businessId: sale.business_id,
          source: 'pos_loyalty',
          operation: 'void_sale_loyalty',
          title: 'POS sale loyalty reversal failed',
          error: err,
          context: { saleId: id, customerId: sale.customer_id, locationId: sale.location_id },
          reference: { type: 'pos_sale', id },
        });
      }
      throw err;
    } finally {
      stockConn.release();
    }
  },

  /**
   * Full replace of a completed sale's items/payments/totals — used by the
   * manager-PIN-gated "edit transaction" flow. Preserves `created_at` and
   * `completed_at` (the original timestamp never moves). Adjusts IMS stock
   * by the DELTA between the old and new item quantities per variant (not
   * a blind re-deduction), so partial edits net out correctly.
   */
  async updateFull(id: number, data: {
    sale_type:      'sale' | 'return' | 'layby';
    customer_name?: string | null;
    customer_phone?: string | null;
    notes?:         string | null;
    subtotal:       number;
    discount_total: number;
    tax_total:      number;
    total:          number;
    cash_rounding?: number;
    actor_id?:      string | number | null;
    items: Array<{
      variant_id:      string | null;
      code:            string | null;
      name:            string;
      qty:             number;
      unit_price:      number;
      original_price?: number | null;
      discount_type:   'none' | 'percent' | 'amount';
      discount_value:  number;
      discount_amount: number;
      tax_rate:        number;
      line_total:      number;
      is_gift_card?:   boolean;
    }>;
    payments: Array<{ payment_method: string; amount: number; reference?: string | null }>;
  }): Promise<{ stockError?: string; stockWarnings: PosStockWarning[]; loyalty?: LoyaltyMutationResult | null }> {
    const existing = await this.get(id);
    if (!existing) throw new Error('Sale not found.');
    const { sale: oldSale, items: oldItems } = existing;

    const pool = getIMSPool();
    const conn = await pool.getConnection();
    let loyaltyWriteAttempted = false;
    let loyalty: LoyaltyMutationResult | null = null;
    try {
      await conn.beginTransaction();

      const [lockedSaleRows] = await conn.execute<any[]>(
        `SELECT business_id, customer_id, status, sale_type, loyalty_earn_rate
           FROM pos_sales
          WHERE id = ?
          LIMIT 1
          FOR UPDATE`,
        [id],
      );
      const lockedSale = lockedSaleRows[0];
      if (!lockedSale) throw new Error('Sale not found.');
      const [linkedReturns] = await conn.execute<any[]>(
        `SELECT id
           FROM pos_sales
          WHERE business_id = ? AND return_of_sale_id = ? AND sale_type = 'return' AND status = 'completed'
          LIMIT 1
          FOR UPDATE`,
        [lockedSale.business_id, id],
      );
      if (linkedReturns[0]) {
        throw new LoyaltyEditBlockedError('This sale has linked returns and can no longer be edited. Void or correct the linked return first.');
      }

      let earnRate = Number(lockedSale.loyalty_earn_rate);
      if (!Number.isFinite(earnRate) || earnRate <= 0) {
        const [settingRows] = await conn.execute<any[]>(
          `SELECT value FROM ims_settings WHERE business_id = ? AND \`key\` = ? LIMIT 1`,
          [lockedSale.business_id, LOYALTY_SETTING_KEYS.earnRate],
        );
        earnRate = Number(settingRows[0]?.value ?? 1);
      }
      const targetPoints = data.sale_type === 'sale'
        ? calculateEarnedPoints({
            merchandiseTotal: calculatePosEligibleSpend({
              items: data.items.map(item => ({
                lineTotal: Number(item.line_total),
                discountAmount: Number(item.discount_amount),
                isGiftCard: Boolean(item.is_gift_card),
              })),
              discountTotal: Number(data.discount_total),
            }),
            earnRate,
          })
        : 0;
      loyaltyWriteAttempted = true;
      loyalty = await LoyaltyRepository.reconcilePosSaleEarn(conn, {
        businessId: String(lockedSale.business_id),
        saleId: id,
        targetPoints,
        actorId: data.actor_id,
      });

      await conn.execute(
        `UPDATE pos_sales SET sale_type = ?, customer_name = ?, customer_phone = ?,
           subtotal = ?, discount_total = ?, tax_total = ?, total = ?, cash_rounding = ?, notes = ?
         WHERE id = ?`,
        [
          data.sale_type,
          data.customer_name ?? null,
          data.customer_phone ?? null,
          data.subtotal,
          data.discount_total,
          data.tax_total,
          data.total,
          data.cash_rounding ?? 0,
          data.notes ?? null,
          id,
        ],
      );

      await conn.execute('DELETE FROM pos_sale_items WHERE sale_id = ?', [id]);
      for (const item of data.items) {
        await conn.execute(
          `INSERT INTO pos_sale_items
             (business_id, sale_id, is_gift_card, variant_id, code, name, qty, unit_price, original_price,
              discount_type, discount_value, discount_amount, tax_rate, line_total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            oldSale.business_id,
            id,
            item.is_gift_card ? 1 : 0,
            item.variant_id ?? null,
            item.code ?? null,
            item.name,
            item.qty,
            item.unit_price,
            item.original_price ?? null,
            item.discount_type,
            item.discount_value,
            item.discount_amount,
            item.tax_rate,
            item.line_total,
          ],
        );
      }

      await conn.execute('DELETE FROM pos_payments WHERE sale_id = ?', [id]);
      for (const pmt of data.payments) {
        await conn.execute(
          `INSERT INTO pos_payments (sale_id, payment_method, amount, reference) VALUES (?, ?, ?, ?)`,
          [id, pmt.payment_method, pmt.amount, pmt.reference ?? null],
        );
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      if (loyaltyWriteAttempted && !(err instanceof LoyaltyValidationError) && !(err instanceof LoyaltyEditBlockedError)) {
        await reportRuntimeIssue({
          businessId: oldSale.business_id,
          source: 'pos_loyalty',
          operation: 'edit_sale_loyalty',
          title: 'POS sale edit loyalty reconciliation failed',
          error: err,
          context: { saleId: id, actorId: data.actor_id ?? null },
          reference: { type: 'pos_sale', id },
        });
      }
      throw err;
    } finally {
      conn.release();
    }

    // Adjust stock by the delta between old and new per-variant net effect —
    // only when the sale had actually deducted/added stock in the first place.
    let stockError: string | undefined;
    const stockWarnings: PosStockWarning[] = [];
    if (['completed', 'layby_complete'].includes(oldSale.status)) {
      const netEffect = (saleType: string, qty: number) => (saleType === 'return' ? qty : -qty);

      const oldMap = new Map<string, number>();
      for (const i of oldItems) {
        if (!i.variant_id) continue;
        oldMap.set(i.variant_id, (oldMap.get(i.variant_id) ?? 0) + netEffect(oldSale.sale_type, i.qty));
      }
      const newMap = new Map<string, number>();
      for (const i of data.items) {
        if (!i.variant_id) continue;
        newMap.set(i.variant_id, (newMap.get(i.variant_id) ?? 0) + netEffect(data.sale_type, i.qty));
      }
      const variantIds = new Set([...oldMap.keys(), ...newMap.keys()]);

      const stockConn = await pool.getConnection();
      try {
        await stockConn.beginTransaction();
        for (const vid of variantIds) {
          const delta = (newMap.get(vid) ?? 0) - (oldMap.get(vid) ?? 0);
          if (!delta) continue;
          const [stockRows]: any = await stockConn.execute(
                `SELECT s.variant_id AS stock_variant_id, s.qty_on_hand, COALESCE(pv.avg_cost, 0) AS avg_cost,
                    COALESCE(p.is_stock_item, 1) AS is_stock_item
             FROM ims_product_variants pv
             JOIN ims_products p ON p.product_id = pv.product_id
             LEFT JOIN ims_stock s ON s.variant_id = pv.variant_id AND s.location_id = ?
             WHERE pv.variant_id = ? LIMIT 1
             FOR UPDATE`,
            [oldSale.location_id, vid],
          );
          if (Number(stockRows[0]?.is_stock_item ?? 1) === 0) continue;
          const currentSoh = Number(stockRows[0]?.qty_on_hand ?? 0);
          const avgCostAtTime = Number(stockRows[0]?.avg_cost ?? 0);
          const stockPlan = await applyPosStockMovementWithFloor(stockConn, {
            businessId: oldSale.business_id,
            variantId: vid,
            locationId: oldSale.location_id,
            saleId: id,
            currentOnHand: currentSoh,
            requestedChange: delta,
            averageCost: avgCostAtTime,
            hasStockRow: Boolean(stockRows[0]?.stock_variant_id),
            movementNote: 'Adjusted via manager transaction edit',
          });
          if (stockPlan.automaticAdjustmentQuantity > 0) {
            stockWarnings.push({
              variantId: vid,
              itemName: data.items.find(item => item.variant_id === vid)?.name ?? vid,
              previousOnHand: currentSoh,
              resultingOnHand: stockPlan.resultingOnHand,
              uncappedResultingOnHand: stockPlan.uncappedResultingOnHand,
              automaticAdjustmentQuantity: stockPlan.automaticAdjustmentQuantity,
              quantityCommitted: 0,
              reason: 'negative_stock',
            });
          }
        }
        await stockConn.commit();
      } catch (err: any) {
        await stockConn.rollback();
        stockError = err?.message || String(err);
        console.error(`[POS] Sale ${id} edited but stock adjustment failed:`, err);
      } finally {
        stockConn.release();
      }
    }
    if (loyalty && oldSale.customer_id) {
      await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({
        businessId: oldSale.business_id,
        contactId: oldSale.customer_id,
      });
    }
    return { stockError, stockWarnings, loyalty };
  },
};

// ─── POS EOD Repository ───────────────────────────────────────────────────────

export const PosEodRepo = {
  async get(locationId: number, date: string, registerId?: number | null): Promise<PosEodRow[]> {
    const rows = await imsQuery<any>(
      registerId != null
        ? 'SELECT * FROM pos_eod_reconciliations WHERE location_id = ? AND recon_date = ? AND register_id = ? ORDER BY payment_method'
        : 'SELECT * FROM pos_eod_reconciliations WHERE location_id = ? AND recon_date = ? ORDER BY payment_method',
      registerId != null ? [locationId, date, registerId] : [locationId, date],
    );
    return rows.map(this._mapRow);
  },

  /**
   * Load saved reconciliation rows scoped to a single register SESSION.
   *
   * The `uq_eod` unique key is (location_id, register_id, recon_date,
   * payment_method) — it does NOT include register_session_id — so a fresh
   * session opened on the same register/date would otherwise inherit the
   * PREVIOUS session's saved counted amounts. This returns only:
   *   • rows already stamped with THIS session's id, and
   *   • the as-yet-unclaimed opening-float row (register_session_id IS NULL)
   *     for this register/date, written when the register was opened.
   * A new session therefore starts with empty counted fields until it saves.
   */
  async getBySession(
    registerSessionId: number,
    fallback: { locationId: number; date: string; registerId: number | null },
  ): Promise<PosEodRow[]> {
    // register_id may legitimately be null in the DB (pre-register-id era rows);
    // using `= null` in a prepared statement never matches — we must use IS NULL.
    const hasReg = fallback.registerId != null;
    const rows = await imsQuery<any>(
      hasReg
        ? `SELECT * FROM pos_eod_reconciliations
            WHERE register_session_id = ?
               OR (register_session_id IS NULL AND counted_amount IS NULL
                   AND location_id = ? AND register_id = ? AND recon_date = ?)
            ORDER BY payment_method`
        : `SELECT * FROM pos_eod_reconciliations
            WHERE register_session_id = ?
               OR (register_session_id IS NULL AND counted_amount IS NULL
                   AND location_id = ? AND register_id IS NULL AND recon_date = ?)
            ORDER BY payment_method`,
      hasReg
        ? [registerSessionId, fallback.locationId, fallback.registerId, fallback.date]
        : [registerSessionId, fallback.locationId, fallback.date],
    );
    return rows.map(this._mapRow);
  },

  _mapRow(r: any): PosEodRow {
    return {
      ...r,
      expected_amount: r.expected_amount != null ? toNum(r.expected_amount) : null,
      counted_amount:  r.counted_amount  != null ? toNum(r.counted_amount)  : null,
      opening_float:   r.opening_float   != null ? toNum(r.opening_float)   : null,
      denomination_data: r.denomination_data
        ? (typeof r.denomination_data === 'string' ? JSON.parse(r.denomination_data) : r.denomination_data)
        : null,
    };
  },

  async getExpected(locationId: number, date: string, registerId?: number | null): Promise<Record<string, number>> {
    const [rows, pettyCashRows] = await Promise.all([
      imsQuery<any>(
        registerId != null
          ? `SELECT p.payment_method, COALESCE(SUM(p.amount), 0) AS total
           FROM pos_payments p
           JOIN pos_sales s ON s.id = p.sale_id
           WHERE s.location_id = ? AND s.register_id = ? AND DATE(s.completed_at) = ?
             AND s.status IN ('completed','layby_complete')
           GROUP BY p.payment_method`
          : `SELECT p.payment_method, COALESCE(SUM(p.amount), 0) AS total
           FROM pos_payments p
           JOIN pos_sales s ON s.id = p.sale_id
           WHERE s.location_id = ? AND DATE(s.completed_at) = ?
             AND s.status IN ('completed','layby_complete')
           GROUP BY p.payment_method`,
        registerId != null ? [locationId, registerId, date] : [locationId, date],
      ),
      imsQuery<{ total: string }>(
        registerId != null
          ? `SELECT COALESCE(SUM(amount), 0) AS total FROM pos_petty_cash_transactions
              WHERE location_id = ? AND register_id = ? AND transaction_date = ? AND status = 'recorded'`
          : `SELECT COALESCE(SUM(amount), 0) AS total FROM pos_petty_cash_transactions
              WHERE location_id = ? AND transaction_date = ? AND status = 'recorded'`,
        registerId != null ? [locationId, registerId, date] : [locationId, date],
      ),
    ]);
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.payment_method] = toNum(row.total);
    }
    const pettyCash = toNum(pettyCashRows[0]?.total);
    if (pettyCash !== 0) {
      const cashKey = Object.keys(result).find(key => key.trim().toLowerCase() === 'cash') ?? 'Cash';
      result[cashKey] = Math.round(((result[cashKey] ?? 0) - pettyCash) * 100) / 100;
    }
    return result;
  },

  /**
   * Build a WHERE condition matching every sale that belongs to one register
   * session. When a fallback (register/location) is supplied it ALSO catches
   * sales whose register_session_id was never stored — e.g. an offline-first
   * sale that synced after the session was closed — by matching the session's
   * actual opened_at → closed_at (or NOW(), if still open) time window rather
   * than a single calendar date. The `register_session_id IS NULL` guard means
   * sales already attributed to a different session are never double-counted.
   *
   * @param prefix column alias prefix for the query ('s.' or '').
   */
  async _sessionMatchClause(
    registerSessionId: number,
    prefix: string,
    fallback?: { locationId: number; date: string; registerId: number | null },
  ): Promise<{ clause: string; params: any[] }> {
    if (fallback?.registerId == null) {
      return { clause: `${prefix}register_session_id = ?`, params: [registerSessionId] };
    }
    const sess = await imsQuery<any>(
      'SELECT opened_at, closed_at FROM pos_register_sessions WHERE id = ? LIMIT 1',
      [registerSessionId],
    );
    const openedAt = sess[0]?.opened_at ?? null;
    const closedAt = sess[0]?.closed_at ?? null;
    if (openedAt) {
      // Time-window fallback: opened_at → closed_at.
      // For open sessions (closed_at IS NULL) we intentionally omit the upper
      // bound — using COALESCE(closed_at, NOW()) fails because the DB server
      // clock can lag behind the application server, causing completed_at values
      // to appear "in the future" relative to DB NOW().
      // register_id is intentionally omitted — sales in this codebase currently
      // have register_id = null, so filtering by it would exclude every row.
      if (closedAt) {
        return {
          clause:
            `(${prefix}register_session_id = ? ` +
            `OR (${prefix}register_session_id IS NULL AND ${prefix}location_id = ? ` +
            `AND ${prefix}completed_at >= ? AND ${prefix}completed_at <= ?))`,
          params: [registerSessionId, fallback.locationId, openedAt, closedAt],
        };
      }
      return {
        clause:
          `(${prefix}register_session_id = ? ` +
          `OR (${prefix}register_session_id IS NULL AND ${prefix}location_id = ? ` +
          `AND ${prefix}completed_at >= ?))`,
        params: [registerSessionId, fallback.locationId, openedAt],
      };
    }
    // No session row found — fall back to the single-date match (legacy behaviour).
    return {
      clause:
        `(${prefix}register_session_id = ? ` +
        `OR (${prefix}register_session_id IS NULL AND ${prefix}location_id = ? ` +
        `AND DATE(${prefix}completed_at) = ?))`,
      params: [registerSessionId, fallback.locationId, fallback.date],
    };
  },

  /**
   * Expected takings for a single register SESSION (open → close window),
   * keyed by payment method. Correctly handles shifts that cross midnight or
   * registers left open across days. See _sessionMatchClause for the fallback.
   */
  async getExpectedBySession(
    registerSessionId: number,
    fallback?: { locationId: number; date: string; registerId: number | null },
  ): Promise<Record<string, number>> {
    const { clause, params } = await this._sessionMatchClause(registerSessionId, 's.', fallback);
    const [rows, pettyCashRows] = await Promise.all([
      imsQuery<any>(
        `SELECT p.payment_method, COALESCE(SUM(p.amount), 0) AS total
         FROM pos_payments p
         JOIN pos_sales s ON s.id = p.sale_id
        WHERE s.status IN ('completed','layby_complete')
          AND ${clause}
        GROUP BY p.payment_method`,
        params,
      ),
      imsQuery<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0) AS total
           FROM pos_petty_cash_transactions
          WHERE register_session_id = ? AND status = 'recorded'`,
        [registerSessionId],
      ),
    ]);
    const result: Record<string, number> = {};
    for (const row of rows) result[row.payment_method] = toNum(row.total);
    const pettyCash = toNum(pettyCashRows[0]?.total);
    if (pettyCash !== 0) {
      const cashKey = Object.keys(result).find(key => key.trim().toLowerCase() === 'cash') ?? 'Cash';
      result[cashKey] = Math.round(((result[cashKey] ?? 0) - pettyCash) * 100) / 100;
    }
    return result;
  },

  /** Sales totals (incl/excl tax, count) for a single register session. Accepts same fallback as getExpectedBySession. */
  async getDayTotalsBySession(
    registerSessionId: number,
    fallback?: { locationId: number; date: string; registerId: number | null },
  ): Promise<{ total_inc_tax: number; tax_total: number; total_exc_tax: number; sale_count: number }> {
    const { clause, params } = await this._sessionMatchClause(registerSessionId, '', fallback);
    const rows = await imsQuery<any>(
      `SELECT COALESCE(SUM(total), 0) AS total_inc_tax,
              COALESCE(SUM(tax_total), 0) AS tax_total,
              COALESCE(SUM(total - tax_total), 0) AS total_exc_tax,
              COUNT(*) AS sale_count
         FROM pos_sales
        WHERE status IN ('completed','layby_complete')
          AND ${clause}`,
      params,
    );
    const r = rows[0] ?? {};
    return {
      total_inc_tax: toNum(r.total_inc_tax),
      tax_total:     toNum(r.tax_total),
      total_exc_tax: toNum(r.total_exc_tax),
      sale_count:    Number(r.sale_count) || 0,
    };
  },

  async save(data: {
    location_id:      number;
    register_id:      number | null;
    register_session_id?: number | null;
    cashier_id:       number | null;
    cashier_name:     string | null;
    recon_date:       string;
    payment_method:   string;
    expected_amount:  number | null;
    counted_amount:   number | null;
    opening_float:    number | null;
    denomination_data?: Record<string, number> | null;
    notes?:           string | null;
  }): Promise<void> {
    await imsExecute(
      `INSERT INTO pos_eod_reconciliations
         (location_id, register_id, register_session_id, cashier_id, cashier_name, recon_date, payment_method,
          expected_amount, counted_amount, opening_float, denomination_data, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         xero_invoice_id   = IF(register_session_id <=> VALUES(register_session_id), xero_invoice_id, NULL),
         xero_synced_at    = IF(register_session_id <=> VALUES(register_session_id), xero_synced_at,  NULL),
         xero_payment_required = IF(register_session_id <=> VALUES(register_session_id), xero_payment_required, 0),
         xero_payment_id   = IF(register_session_id <=> VALUES(register_session_id), xero_payment_id, NULL),
         xero_payment_synced_at = IF(register_session_id <=> VALUES(register_session_id), xero_payment_synced_at, NULL),
         xero_payment_error = IF(register_session_id <=> VALUES(register_session_id), xero_payment_error, NULL),
         xero_clearing_account_code = IF(register_session_id <=> VALUES(register_session_id), xero_clearing_account_code, NULL),
         register_session_id = VALUES(register_session_id),
         cashier_id        = VALUES(cashier_id),
         cashier_name      = VALUES(cashier_name),
         expected_amount   = VALUES(expected_amount),
         counted_amount    = VALUES(counted_amount),
         opening_float     = VALUES(opening_float),
         denomination_data = VALUES(denomination_data),
         notes             = VALUES(notes)`,
      [
        data.location_id,
        data.register_id ?? null,
        data.register_session_id ?? null,
        data.cashier_id ?? null,
        data.cashier_name ?? null,
        data.recon_date,
        data.payment_method,
        data.expected_amount ?? null,
        data.counted_amount ?? null,
        data.opening_float ?? null,
        data.denomination_data ? JSON.stringify(data.denomination_data) : null,
        data.notes ?? null,
      ],
    );
  },

  async setXeroInvoice(locationId: number, date: string, method: string, invoiceId: string, clearingAccountCode: string, registerId?: number | null, paymentRequired = true): Promise<void> {
    if (registerId != null) {
      await imsExecute(
        `UPDATE pos_eod_reconciliations
           SET xero_invoice_id = ?, xero_synced_at = NOW(),
               xero_payment_required = ?, xero_clearing_account_code = ?,
               xero_payment_error = NULL
           WHERE location_id = ? AND register_id = ? AND recon_date = ? AND payment_method = ?`,
        [invoiceId, paymentRequired ? 1 : 0, clearingAccountCode || null, locationId, registerId, date, method],
      );
    } else {
      await imsExecute(
        `UPDATE pos_eod_reconciliations
           SET xero_invoice_id = ?, xero_synced_at = NOW(),
               xero_payment_required = ?, xero_clearing_account_code = ?,
               xero_payment_error = NULL
           WHERE location_id = ? AND recon_date = ? AND payment_method = ?`,
        [invoiceId, paymentRequired ? 1 : 0, clearingAccountCode || null, locationId, date, method],
      );
    }
  },

  async setXeroPayment(locationId: number, date: string, method: string, paymentId: string, clearingAccountCode: string, registerId?: number | null): Promise<void> {
    if (registerId != null) {
      await imsExecute(
        `UPDATE pos_eod_reconciliations
           SET xero_payment_id = ?, xero_payment_synced_at = NOW(),
               xero_clearing_account_code = ?, xero_payment_error = NULL
           WHERE location_id = ? AND register_id = ? AND recon_date = ? AND payment_method = ?`,
        [paymentId, clearingAccountCode, locationId, registerId, date, method],
      );
    } else {
      await imsExecute(
        `UPDATE pos_eod_reconciliations
           SET xero_payment_id = ?, xero_payment_synced_at = NOW(),
               xero_clearing_account_code = ?, xero_payment_error = NULL
           WHERE location_id = ? AND recon_date = ? AND payment_method = ?`,
        [paymentId, clearingAccountCode, locationId, date, method],
      );
    }
  },

  async setXeroPaymentError(locationId: number, date: string, method: string, error: string, clearingAccountCode: string, registerId?: number | null): Promise<void> {
    if (registerId != null) {
      await imsExecute(
        `UPDATE pos_eod_reconciliations
           SET xero_payment_error = ?, xero_clearing_account_code = ?
           WHERE location_id = ? AND register_id = ? AND recon_date = ? AND payment_method = ?`,
        [error, clearingAccountCode, locationId, registerId, date, method],
      );
    } else {
      await imsExecute(
        `UPDATE pos_eod_reconciliations
           SET xero_payment_error = ?, xero_clearing_account_code = ?
           WHERE location_id = ? AND recon_date = ? AND payment_method = ?`,
        [error, clearingAccountCode, locationId, date, method],
      );
    }
  },
};

// ─── POS Registers Repository ─────────────────────────────────────────────────

function parseRegister(r: any): PosRegisterRow {
  return {
    ...r,
    default_float:           toNum(r.default_float),
    card_terminal_provider:  r.card_terminal_provider  ?? null,
    zeller_site_id:          r.zeller_site_id          ?? null,
    zeller_terminal_id:      r.zeller_terminal_id      ?? null,
    zeller_api_key:          r.zeller_api_key          ?? null,
    card_terminal_methods:   r.card_terminal_methods   ?? null,
  };
}

export const PosRegistersRepo = {
  async listForLocation(locationId: number): Promise<PosRegisterRow[]> {
    const rows = await imsQuery<any>(
      'SELECT * FROM pos_registers WHERE location_id = ? ORDER BY id',
      [locationId],
    );
    return rows.map(parseRegister);
  },

  async get(id: number): Promise<PosRegisterRow | null> {
    const rows = await imsQuery<any>('SELECT * FROM pos_registers WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? parseRegister(rows[0]) : null;
  },

  async getDefaultForLocation(locationId: number): Promise<PosRegisterRow | null> {
    const rows = await imsQuery<any>(
      "SELECT * FROM pos_registers WHERE location_id = ? AND name = 'Default Register' LIMIT 1",
      [locationId],
    );
    return rows[0] ? parseRegister(rows[0]) : null;
  },

  async create(locationId: number, name: string, defaultFloat: number): Promise<number> {
    const result = await imsExecute(
      'INSERT INTO pos_registers (location_id, name, default_float) VALUES (?, ?, ?)',
      [locationId, name.trim(), defaultFloat],
    );
    return result.insertId;
  },

  async update(id: number, data: {
    name?:                   string;
    default_float?:          number;
    is_active?:              number;
    card_terminal_provider?: string | null;
    zeller_site_id?:         string | null;
    zeller_terminal_id?:     string | null;
    zeller_api_key?:         string | null;
    card_terminal_methods?:  string | null;
  }): Promise<void> {
    const fields: string[] = [];
    const vals:   any[]    = [];
    if (data.name                   !== undefined) { fields.push('name = ?');                   vals.push(data.name.trim()); }
    if (data.default_float          !== undefined) { fields.push('default_float = ?');          vals.push(data.default_float); }
    if (data.is_active              !== undefined) { fields.push('is_active = ?');              vals.push(data.is_active); }
    if (data.card_terminal_provider !== undefined) { fields.push('card_terminal_provider = ?'); vals.push(data.card_terminal_provider); }
    if (data.zeller_site_id         !== undefined) { fields.push('zeller_site_id = ?');         vals.push(data.zeller_site_id); }
    if (data.zeller_terminal_id     !== undefined) { fields.push('zeller_terminal_id = ?');     vals.push(data.zeller_terminal_id); }
    if (data.zeller_api_key         !== undefined) { fields.push('zeller_api_key = ?');         vals.push(data.zeller_api_key); }
    if (data.card_terminal_methods  !== undefined) { fields.push('card_terminal_methods = ?');  vals.push(data.card_terminal_methods); }
    if (!fields.length) return;
    vals.push(id);
    await imsExecute(`UPDATE pos_registers SET ${fields.join(', ')} WHERE id = ?`, vals);
  },

  async listAll(businessId: string): Promise<(PosRegisterRow & { location_name: string })[]> {
    const rows = await imsQuery<any>(
      `SELECT r.*, l.name AS location_name
       FROM pos_registers r
       JOIN ims_locations l ON l.id = r.location_id AND l.business_id = ?
       ORDER BY l.name, r.name`,
      [businessId],
    );
    return rows.map(r => ({ ...parseRegister(r), location_name: r.location_name ?? '' }));
  },
};

// ─── POS Register Session Repository ─────────────────────────────────────────

function parseSession(r: any): PosRegisterSessionRow {
  // Normalize session_date to 'YYYY-MM-DD' string — mysql2 may return DATE
  // columns as JS Date objects which serialize to ISO timestamps in JSON,
  // causing downstream date comparisons and Xero invoice dates to be wrong.
  const rawDate = r.session_date;
  const sessionDate: string | null =
    rawDate instanceof Date    ? rawDate.toISOString().slice(0, 10)
    : typeof rawDate === 'string' ? rawDate.slice(0, 10)
    : rawDate ?? null;
  return {
    ...r,
    session_date: sessionDate,
    opening_float: r.opening_float != null ? toNum(r.opening_float) : null,
    denomination_data: r.denomination_data
      ? (typeof r.denomination_data === 'string' ? JSON.parse(r.denomination_data) : r.denomination_data)
      : null,
  };
}

export const PosRegisterSessionRepo = {
  /** Get the currently open session for a register (null if none). */
  async getCurrent(registerId: number): Promise<PosRegisterSessionRow | null> {
    const rows = await imsQuery<any>(
      "SELECT * FROM pos_register_sessions WHERE register_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
      [registerId],
    );
    return rows[0] ? parseSession(rows[0]) : null;
  },

  /** Most recent session for a register regardless of status (used by EOD). */
  async getLatest(registerId: number): Promise<PosRegisterSessionRow | null> {
    const rows = await imsQuery<any>(
      'SELECT * FROM pos_register_sessions WHERE register_id = ? ORDER BY opened_at DESC LIMIT 1',
      [registerId],
    );
    return rows[0] ? parseSession(rows[0]) : null;
  },

  /** Get the session for a specific date (any status). */
  async getForDay(registerId: number, date: string): Promise<PosRegisterSessionRow | null> {
    const rows = await imsQuery<any>(
      'SELECT * FROM pos_register_sessions WHERE register_id = ? AND session_date = ? ORDER BY opened_at DESC LIMIT 1',
      [registerId, date],
    );
    return rows[0] ? parseSession(rows[0]) : null;
  },

  /** Get a session by its id (any status, null if not found). */
  async getById(sessionId: number): Promise<PosRegisterSessionRow | null> {
    const rows = await imsQuery<any>(
      'SELECT * FROM pos_register_sessions WHERE id = ? LIMIT 1',
      [sessionId],
    );
    return rows[0] ? parseSession(rows[0]) : null;
  },

  async open(data: {
    register_id:      number;
    location_id:      number;
    session_date:     string;
    opened_at:        string;
    opened_by:        string | null;
    opening_float:    number | null;
    denomination_data?: Record<string, number> | null;
  }): Promise<number> {
    const result = await imsExecute(
      `INSERT INTO pos_register_sessions
         (register_id, location_id, session_date, opened_at, opened_by, opening_float, denomination_data, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
      [
        data.register_id,
        data.location_id,
        data.session_date,
        data.opened_at,
        data.opened_by ?? null,
        data.opening_float ?? null,
        data.denomination_data ? JSON.stringify(data.denomination_data) : null,
      ],
    );
    return result.insertId;
  },

  /**
   * Atomically open a register session, guarding against a race where two
   * devices open the same register simultaneously. Locks existing open rows
   * for the register inside a transaction; if one already exists, returns it
   * instead of inserting a duplicate.
   */
  async openAtomic(data: {
    register_id:      number;
    location_id:      number;
    session_date:     string;
    opened_at:        string;
    opened_by:        string | null;
    opening_float:    number | null;
    denomination_data?: Record<string, number> | null;
  }): Promise<{ created: boolean; session_id: number; existing?: PosRegisterSessionRow }> {
    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [openRows]: any = await conn.execute(
        "SELECT * FROM pos_register_sessions WHERE register_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1 FOR UPDATE",
        [data.register_id],
      );
      if (openRows[0]) {
        await conn.commit();
        return { created: false, session_id: openRows[0].id, existing: parseSession(openRows[0]) };
      }
      const [ins]: any = await conn.execute(
        `INSERT INTO pos_register_sessions
           (register_id, location_id, session_date, opened_at, opened_by, opening_float, denomination_data, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
        [
          data.register_id,
          data.location_id,
          data.session_date,
          data.opened_at,
          data.opened_by ?? null,
          data.opening_float ?? null,
          data.denomination_data ? JSON.stringify(data.denomination_data) : null,
        ],
      );
      await conn.commit();
      return { created: true, session_id: ins.insertId };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async close(sessionId: number, closedAt: string, closedBy: string | null): Promise<void> {
    await imsExecute(
      "UPDATE pos_register_sessions SET status = 'closed', closed_at = ?, closed_by = ? WHERE id = ?",
      [closedAt, closedBy ?? null, sessionId],
    );
  },
};

// ─── POS Reports ──────────────────────────────────────────────────────────────

export const PosReportsRepo = {
  async dailyTransactions(locationId: number, date: string): Promise<{
    sale: PosSaleRow;
    items: PosSaleItemRow[];
    payments: PosPaymentRow[];
  }[]> {
    const sales = await imsQuery<any>(
      `SELECT s.*
       FROM pos_sales s
       WHERE s.location_id = ? AND DATE(s.created_at) = ?
         AND s.status IN ('completed','layby_complete')
       ORDER BY s.created_at`,
      [locationId, date],
    );
    if (!sales.length) return [];

    const ids = sales.map((s: any) => s.id);
    const placeholders = ids.map(() => '?').join(',');

    const allItems = (await imsQuery<any>(
      `SELECT * FROM pos_sale_items WHERE sale_id IN (${placeholders})`,
      ids,
    )).map(parseItem);

    const allPayments = (await imsQuery<any>(
      `SELECT * FROM pos_payments WHERE sale_id IN (${placeholders}) ORDER BY created_at`,
      ids,
    )).map(parsePayment);

    return sales.map((s: any) => ({
      sale:     parseSale(s),
      items:    allItems.filter((i) => i.sale_id === s.id),
      payments: allPayments.filter((p) => p.sale_id === s.id),
    }));
  },

  async graphData(locationId: number, days: number): Promise<{ date: string; total: number; count: number }[]> {
    const rows = await imsQuery<any>(
      `SELECT DATE(completed_at) AS date,
              COALESCE(SUM(total), 0) AS total,
              COUNT(*) AS count
       FROM pos_sales
       WHERE location_id = ?
         AND status IN ('completed','layby_complete')
         AND completed_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(completed_at)
       ORDER BY date`,
      [locationId, days],
    );
    return rows.map((r: any) => ({
      date:  r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
      total: toNum(r.total),
      count: Number(r.count),
    }));
  },
};
