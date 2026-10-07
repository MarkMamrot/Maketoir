import { getIMSPool, imsQuery } from '@/services/IMSMySQLService';
import { laybyCents, laybyFeePercent, LaybyValidationError, planLaybyCancellation, planLaybyPayment } from './laybyPayments';
import { posLocationSettingsKey } from './locationSettings';
import { lockInventoryCostState } from '@/lib/ims/costing/fifoCostingService';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { LoyaltyRepository } from '@/lib/ims/LoyaltyRepository';
import { LOYALTY_SETTING_KEYS } from '@/lib/loyalty/types';
import { calculateEarnedPoints, calculatePosEligibleSpend } from '@/lib/loyalty/calculations';

type Connection = Awaited<ReturnType<ReturnType<typeof getIMSPool>['getConnection']>>;
type Tender = { payment_method: string; amount: number; reference?: string | null };
export type LaybyActor = { businessId: string; locationId: number; registerId: number; registerSessionId: number; cashierId: number | null };

async function timestamp(businessId: string) {
  return new Date().toLocaleString('sv-SE', { timeZone: await getBusinessTimeZone(businessId) }).replace('T', ' ');
}

function validateTender(payments: Tender[]) {
  if (payments.length === 0 || payments.length > 20 || payments.some(payment =>
    typeof payment?.payment_method !== 'string' || !payment.payment_method.trim() || /gift|store credit|issue|no charge/i.test(payment.payment_method)
    || !Number.isFinite(Number(payment.amount)) || laybyCents(Math.abs(Number(payment.amount))) <= 0)) {
    throw new LaybyValidationError('Use actual cash or card payments for laybys; gift cards and store credit are not supported.');
  }
}

async function event(connection: Connection, input: {
  actor: LaybyActor; saleId: number; key: string; kind: string; amount?: number; now: string;
  paymentId?: number; method?: string; reason?: string;
}) {
  await connection.execute(
    `INSERT INTO pos_layby_events
       (business_id, sale_id, operation_key, kind, amount, payment_id, payment_method,
        location_id, register_id, register_session_id, cashier_id, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.actor.businessId, input.saleId, input.key, input.kind, input.amount ?? 0, input.paymentId ?? null,
      input.method ?? null, input.actor.locationId, input.actor.registerId, input.actor.registerSessionId,
      input.actor.cashierId, input.reason?.trim().slice(0, 1000) ?? null, input.now],
  );
}

async function reserve(connection: Connection, sale: any, items: any[], now: string) {
  const quantities = new Map<string, number>();
  for (const item of items) {
    if (!Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0 || item.is_gift_card) throw new LaybyValidationError('Laybys require positive merchandise quantities.');
    if (item.variant_id) quantities.set(item.variant_id, (quantities.get(item.variant_id) ?? 0) + Number(item.qty));
  }
  for (const [variantId, quantity] of [...quantities].sort(([first], [second]) => first.localeCompare(second))) {
    const [rows]: any = await connection.execute(
      `SELECT stock.qty_on_hand, stock.qty_committed, product.is_stock_item
         FROM ims_product_variants variant
         JOIN ims_products product ON product.product_id = variant.product_id
         LEFT JOIN ims_stock stock ON stock.variant_id = variant.variant_id AND stock.location_id = ?
        WHERE variant.variant_id = ? AND product.business_id = ? FOR UPDATE`,
      [sale.location_id, variantId, sale.business_id],
    );
    if (!rows[0]) throw new LaybyValidationError('A layby product no longer belongs to this business.');
    if (Number(rows[0].is_stock_item) === 0) continue;
    if (Number(rows[0].qty_on_hand ?? 0) - Number(rows[0].qty_committed ?? 0) + 0.000001 < quantity) {
      throw new LaybyValidationError(`Insufficient available branch stock to reserve ${variantId}. Refresh stock before taking a deposit.`);
    }
    await connection.execute('UPDATE ims_stock SET qty_committed = qty_committed + ? WHERE variant_id = ? AND location_id = ?', [quantity, variantId, sale.location_id]);
    await connection.execute(
      'INSERT INTO pos_layby_reservations (sale_id, business_id, variant_id, location_id, quantity) VALUES (?, ?, ?, ?, ?)',
      [sale.id, sale.business_id, variantId, sale.location_id, quantity],
    );
  }
}

async function release(connection: Connection, sale: any, now: string, collecting: boolean) {
  const [reservations]: any = await connection.execute(
    'SELECT * FROM pos_layby_reservations WHERE sale_id = ? AND business_id = ? AND released_at IS NULL ORDER BY variant_id FOR UPDATE',
    [sale.id, sale.business_id],
  );
  for (const reservation of reservations) {
    const [stocks]: any = await connection.execute('SELECT qty_on_hand, qty_committed FROM ims_stock WHERE variant_id = ? AND location_id = ? FOR UPDATE', [reservation.variant_id, sale.location_id]);
    if (Number(stocks[0]?.qty_committed ?? 0) + 0.000001 < Number(reservation.quantity)
      || (collecting && Number(stocks[0]?.qty_on_hand ?? 0) + 0.000001 < Number(stocks[0]?.qty_committed ?? 0))) {
      throw new LaybyValidationError('Reserved stock changed. Resolve the branch stock discrepancy before continuing.');
    }
    await connection.execute('UPDATE ims_stock SET qty_committed = qty_committed - ? WHERE variant_id = ? AND location_id = ?', [reservation.quantity, reservation.variant_id, sale.location_id]);
  }
  await connection.execute('UPDATE pos_layby_reservations SET released_at = ? WHERE sale_id = ? AND business_id = ? AND released_at IS NULL', [now, sale.id, sale.business_id]);
}

export async function initializeLayby(connection: Connection, sale: any, items: any[], payments: any[], actor: LaybyActor, now: string) {
  validateTender(payments);
  if (payments.some(payment => Number(payment.amount) <= 0)) throw new LaybyValidationError('Opening deposits must be positive.');
  if (!sale.customer_id) throw new LaybyValidationError('Link a customer before saving a layby.');
  const [customers]: any = await connection.execute('SELECT id FROM ims_contacts WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1', [sale.customer_id, sale.business_id]);
  if (!customers.length) throw new LaybyValidationError('Select an active customer from this business.');
  const paid = payments.reduce((sum, payment) => sum + laybyCents(Number(payment.amount)), 0) / 100;
  if (paid <= 0 || laybyCents(paid) > laybyCents(Number(sale.total))) throw new LaybyValidationError('The actual deposit cannot exceed the merchandise total.');
  const [settings]: any = await connection.execute('SELECT value FROM ims_settings WHERE business_id = ? AND `key` = ?', [sale.business_id, posLocationSettingsKey(sale.location_id)]);
  const fullyPaid = laybyCents(paid) === laybyCents(Number(sale.total));
  await connection.execute(
    'INSERT INTO pos_laybys (sale_id, business_id, location_id, state, paid_total, fee_percent, gst_recognized, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [sale.id, sale.business_id, sale.location_id, fullyPaid ? 'paid' : 'active', paid, laybyFeePercent(settings[0]?.value), fullyPaid ? Number(sale.tax_total) : 0, now],
  );
  await reserve(connection, sale, items, now);
  for (const payment of payments) {
    await event(connection, { actor, saleId: sale.id, key: `open:${sale.id}:${payment.id}`, kind: 'receipt', amount: Number(payment.amount), paymentId: payment.id, method: payment.payment_method, now });
  }
  if (fullyPaid) await event(connection, { actor, saleId: sale.id, key: `open:${sale.id}:gst`, kind: 'gst', amount: Number(sale.total), now });
}

export async function collectLaybyInTransaction(connection: Connection, sale: any, items: any[], actor: LaybyActor, key: string, now: string,
  collectStock: (connection: any, data: any, saleId: number, costingState: any) => Promise<unknown>) {
  const costing = await lockInventoryCostState(connection, actor.businessId);
  await release(connection, sale, now, true);
  const warnings = await collectStock(connection, { ...sale, items }, sale.id, costing);
  await connection.execute("UPDATE pos_laybys SET state = 'collected', collected_at = ? WHERE sale_id = ? AND business_id = ?", [now, sale.id, actor.businessId]);
  await connection.execute("UPDATE pos_sales SET status = 'layby_complete', completed_at = ? WHERE id = ? AND business_id = ?", [now, sale.id, actor.businessId]);
  await event(connection, { actor, saleId: sale.id, key, kind: 'collection', amount: (laybyCents(Number(sale.total)) - laybyCents(Number(sale.tax_total))) / 100, now });
  if (sale.customer_id) {
    const [settings]: any = await connection.execute('SELECT `key`, value FROM ims_settings WHERE business_id = ? AND `key` IN (?, ?, ?)', [actor.businessId, LOYALTY_SETTING_KEYS.enabled, LOYALTY_SETTING_KEYS.earnRate, LOYALTY_SETTING_KEYS.startedAt]);
    const values = Object.fromEntries(settings.map((setting: any) => [setting.key, String(setting.value)]));
    if (values[LOYALTY_SETTING_KEYS.enabled] === '1' && (!values[LOYALTY_SETTING_KEYS.startedAt] || now.slice(0, 10) >= String(values[LOYALTY_SETTING_KEYS.startedAt]))) {
      const [members]: any = await connection.execute("SELECT id FROM ims_contacts WHERE id = ? AND business_id = ? AND is_active = 1 AND loyalty_member = 1 AND type IN ('retail_customer','b2b_customer','both') LIMIT 1", [sale.customer_id, actor.businessId]);
      if (members.length) {
        const earnRate = Number(values[LOYALTY_SETTING_KEYS.earnRate] || 1);
        const points = calculateEarnedPoints({ merchandiseTotal: calculatePosEligibleSpend({ items: items.map(item => ({ lineTotal: Number(item.line_total), discountAmount: Number(item.discount_amount), isGiftCard: Boolean(item.is_gift_card) })), discountTotal: Number(sale.discount_total) }), earnRate });
        await connection.execute('UPDATE pos_sales SET loyalty_earn_rate = ? WHERE id = ? AND business_id = ?', [earnRate, sale.id, actor.businessId]);
        if (points > 0) await LoyaltyRepository.applyTransaction(connection, { businessId: actor.businessId, contactId: sale.customer_id, type: 'earn', pointsDelta: points, channel: 'pos', sourceType: 'pos_sale', sourceId: sale.id, idempotencyKey: `pos:sale:${sale.id}:earn`, actorId: actor.cashierId });
      }
    }
  }
  return warnings;
}

export const LaybyRepository = {
  async preflight(businessId: string, locationId: number, customerId: number, items: any[]) {
    if (!Number.isInteger(customerId) || !Array.isArray(items) || !items.length || items.length > 200
      || items.some(item => !item || !Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0 || item.is_gift_card)) {
      throw new LaybyValidationError('Link a customer and use positive merchandise quantities for a layby.');
    }
    const customers = await imsQuery<any>('SELECT id FROM ims_contacts WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1', [customerId, businessId]);
    if (!customers.length) throw new LaybyValidationError('Select an active customer from this business.');
    const quantities = new Map<string, number>();
    for (const item of items) if (item.variant_id) quantities.set(String(item.variant_id), (quantities.get(String(item.variant_id)) ?? 0) + Number(item.qty));
    for (const [variantId, quantity] of quantities) {
      const rows = await imsQuery<any>(`SELECT stock.qty_on_hand, stock.qty_committed, product.is_stock_item
        FROM ims_product_variants variant JOIN ims_products product ON product.product_id = variant.product_id
        LEFT JOIN ims_stock stock ON stock.variant_id = variant.variant_id AND stock.location_id = ?
        WHERE variant.variant_id = ? AND product.business_id = ?`, [locationId, variantId, businessId]);
      if (!rows[0] || (Number(rows[0].is_stock_item) !== 0 && Number(rows[0].qty_on_hand ?? 0) - Number(rows[0].qty_committed ?? 0) + 0.000001 < quantity)) {
        throw new LaybyValidationError('There is not enough available branch stock to reserve this layby. Refresh stock before taking a deposit.');
      }
    }
  },
  async list(businessId: string, locationId: number, includeClosed = false) {
    return imsQuery<any>(
      `SELECT sale.id, sale.customer_name, sale.customer_id, sale.total, sale.created_at,
              COALESCE(layby.state, 'legacy') AS layby_state,
              COALESCE(layby.paid_total, (SELECT SUM(amount) FROM pos_payments WHERE sale_id = sale.id), 0) AS paid_total,
              layby.fee_percent, layby.retained_fee,
              CASE WHEN EXISTS (SELECT 1 FROM pos_layby_events event WHERE event.sale_id = sale.id AND event.xero_status = 'error') THEN 'error'
                WHEN EXISTS (SELECT 1 FROM pos_layby_events event WHERE event.sale_id = sale.id AND event.xero_status IN ('pending','posting')) THEN 'pending'
                ELSE 'posted' END AS accounting_status
         FROM pos_sales sale LEFT JOIN pos_laybys layby ON layby.sale_id = sale.id
        WHERE sale.business_id = ? AND sale.location_id = ? AND sale.sale_type = 'layby'
          ${includeClosed ? '' : "AND sale.status = 'layby_active'"}
        ORDER BY sale.created_at DESC LIMIT 200`, [businessId, locationId],
    );
  },

  async act(input: {
    actor: LaybyActor; saleId: number; operationKey: string; action: 'payment' | 'collect' | 'cancel' | 'adopt';
    payments?: Tender[]; collect?: boolean; feeOverride?: number; reason?: string;
    collectStock: (connection: any, data: any, saleId: number, costingState: any) => Promise<unknown>;
  }) {
    if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(input.operationKey)) throw new LaybyValidationError('A valid operation reference is required.');
    const now = await timestamp(input.actor.businessId);
    const connection = await getIMSPool().getConnection();
    try {
      await connection.beginTransaction();
      const [sales]: any = await connection.execute(
        "SELECT * FROM pos_sales WHERE id = ? AND business_id = ? AND location_id = ? AND sale_type = 'layby' FOR UPDATE",
        [input.saleId, input.actor.businessId, input.actor.locationId],
      );
      const sale = sales[0];
      if (!sale) throw new LaybyValidationError('This layby does not belong to the current branch.');
      const [prior]: any = await connection.execute('SELECT id FROM pos_layby_events WHERE business_id = ? AND sale_id = ? AND operation_key = ?', [input.actor.businessId, input.saleId, input.operationKey]);
      if (prior.length) { await connection.commit(); return { saleId: input.saleId, duplicate: true }; }
      const [sessions]: any = await connection.execute(
        "SELECT id FROM pos_register_sessions WHERE id = ? AND register_id = ? AND location_id = ? AND status = 'open' FOR UPDATE",
        [input.actor.registerSessionId, input.actor.registerId, input.actor.locationId],
      );
      if (!sessions.length) throw new LaybyValidationError('Open the current register before changing a layby.');
      const [items]: any = await connection.execute('SELECT * FROM pos_sale_items WHERE sale_id = ? ORDER BY variant_id, id', [input.saleId]);
      const [laybys]: any = await connection.execute('SELECT * FROM pos_laybys WHERE sale_id = ? AND business_id = ? FOR UPDATE', [input.saleId, input.actor.businessId]);
      let layby = laybys[0];
      if (!layby) {
        if (input.action !== 'adopt' || sale.status !== 'layby_active') throw new LaybyValidationError('Reserve this existing layby before taking another payment.');
        const [posted]: any = await connection.execute('SELECT id FROM pos_eod_reconciliations WHERE register_session_id = ? AND xero_invoice_id IS NOT NULL LIMIT 1', [sale.register_session_id]);
        if (posted.length) throw new LaybyValidationError('The original deposit has already been posted to Xero. Reconcile its accounting before adopting this layby.');
        const [payments]: any = await connection.execute('SELECT * FROM pos_payments WHERE sale_id = ? ORDER BY id', [input.saleId]);
        const originalActor = { ...input.actor, registerId: sale.register_id, registerSessionId: sale.register_session_id };
        const originalTime = sale.created_at instanceof Date
          ? sale.created_at.toLocaleString('sv-SE', { timeZone: await getBusinessTimeZone(input.actor.businessId) }).replace('T', ' ')
          : String(sale.created_at);
        await initializeLayby(connection, sale, items, payments, originalActor, originalTime);
        await event(connection, { actor: input.actor, saleId: sale.id, key: input.operationKey, kind: 'cancellation', reason: 'Existing layby adopted; no payment or refund', now });
        await connection.commit();
        return { saleId: sale.id, adopted: true };
      }
      if (!['active', 'paid'].includes(layby.state) || sale.status !== 'layby_active') throw new LaybyValidationError('This layby has already been collected or cancelled.');
      if (input.action === 'adopt') throw new LaybyValidationError('This layby is already reserved.');
      if (input.payments != null && !Array.isArray(input.payments)) throw new LaybyValidationError('Payments must be an array.');
      const payments = input.payments ?? [];
      let collect = input.action === 'collect';
      if (input.action === 'payment') {
        validateTender(payments);
        if (payments.some(payment => payment.amount <= 0)) throw new LaybyValidationError('Instalments must be positive.');
        const amount = payments.reduce((sum, payment) => sum + laybyCents(payment.amount), 0) / 100;
        const plan = planLaybyPayment({ total: Number(sale.total), paid: Number(layby.paid_total), amount, collect: input.collect === true });
        for (const [index, payment] of payments.entries()) {
          const [result]: any = await connection.execute('INSERT INTO pos_payments (business_id, sale_id, payment_method, amount, reference, created_at) VALUES (?, ?, ?, ?, ?, ?)', [input.actor.businessId, sale.id, payment.payment_method, payment.amount, payment.reference ?? null, now]);
          await event(connection, { actor: input.actor, saleId: sale.id, key: index === 0 ? input.operationKey : `${input.operationKey}:${index}`, kind: 'receipt', amount: payment.amount, paymentId: result.insertId, method: payment.payment_method, now });
        }
        if (plan.fullyPaid) await event(connection, { actor: input.actor, saleId: sale.id, key: `${input.operationKey}:gst`, kind: 'gst', amount: Number(sale.total), now });
        await connection.execute('UPDATE pos_laybys SET paid_total = ?, state = ?, gst_recognized = ? WHERE sale_id = ? AND business_id = ?', [plan.paid, plan.fullyPaid ? 'paid' : 'active', plan.fullyPaid ? sale.tax_total : 0, sale.id, input.actor.businessId]);
        layby = { ...layby, paid_total: plan.paid, state: plan.fullyPaid ? 'paid' : 'active', gst_recognized: plan.fullyPaid ? sale.tax_total : 0 };
        collect = plan.collect;
      }
      if (collect) {
        if (layby.state !== 'paid' || laybyCents(Number(layby.paid_total)) !== laybyCents(Number(sale.total))) throw new LaybyValidationError('Pay the full balance before collecting the goods.');
        await collectLaybyInTransaction(connection, sale, items, input.actor, input.action === 'collect' ? input.operationKey : `${input.operationKey}:collect`, now, input.collectStock);
      }
      if (input.action === 'cancel') {
        const plan = planLaybyCancellation({ total: Number(sale.total), paid: Number(layby.paid_total), feePercent: Number(layby.fee_percent), overrideFee: input.feeOverride, reason: input.reason });
        if (plan.refund > 0) validateTender(payments);
        if (payments.some(payment => payment.amount >= 0) || payments.reduce((sum, payment) => sum + laybyCents(payment.amount), 0) !== -laybyCents(plan.refund)) throw new LaybyValidationError('Record exactly the refund due before cancelling.');
        for (const [index, payment] of payments.entries()) {
          const [result]: any = await connection.execute('INSERT INTO pos_payments (business_id, sale_id, payment_method, amount, reference, created_at) VALUES (?, ?, ?, ?, ?, ?)', [input.actor.businessId, sale.id, payment.payment_method, payment.amount, payment.reference ?? null, now]);
          await event(connection, { actor: input.actor, saleId: sale.id, key: `${input.operationKey}:refund:${index}`, kind: 'receipt', amount: payment.amount, paymentId: result.insertId, method: payment.payment_method, now });
        }
        if (Number(layby.gst_recognized) > 0) await event(connection, { actor: input.actor, saleId: sale.id, key: `${input.operationKey}:gst-reversal`, kind: 'gst_reversal', amount: Number(sale.total), now });
        if (plan.fee > 0) await event(connection, { actor: input.actor, saleId: sale.id, key: `${input.operationKey}:fee`, kind: 'cancellation_fee', amount: plan.fee, reason: input.reason, now });
        await release(connection, sale, now, false);
        await connection.execute("UPDATE pos_laybys SET state = 'cancelled', retained_fee = ?, cancelled_at = ?, gst_recognized = 0 WHERE sale_id = ? AND business_id = ?", [plan.fee, now, sale.id, input.actor.businessId]);
        await connection.execute("UPDATE pos_sales SET status = 'voided' WHERE id = ? AND business_id = ?", [sale.id, input.actor.businessId]);
        await event(connection, { actor: input.actor, saleId: sale.id, key: input.operationKey, kind: 'cancellation', amount: plan.fee, reason: input.reason, now });
      }
      await connection.commit();
      return { saleId: sale.id, collected: collect, cancelled: input.action === 'cancel' };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  },
};