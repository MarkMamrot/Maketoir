import { getIMSPool, imsExecute } from '@/services/IMSMySQLService';
import { previewPersistedEarlyPaymentDiscountOrder, type PersistedEarlyPaymentDiscountPreview } from './earlyPaymentDiscount';
import { ImsCNRepo, ImsPORepo, ImsSORepo, ImsSupplierCNRepo } from './ImsRepository';
import { allocateXeroCreditNote, approveCreditNote, syncCNAsCreditNote, syncSupplierCNAsCreditNote } from '@/services/XeroSyncService';

type DocumentType = 'purchase_order' | 'sales_order';

type PaymentInput = {
  paymentDate: string;
  amount: number;
  currencyCode: string;
  exchangeRate: number;
  notes?: string;
  paymentMethodId?: number;
  xeroPostIntent: 'solvantis_only' | 'post_to_xero';
};

export type EarlyPaymentApplicationResult = {
  applicationId: number;
  payment: { id: number } & Record<string, unknown>;
  creditNoteId: number;
  preview: Extract<PersistedEarlyPaymentDiscountPreview, { available: true }>;
  replayed: boolean;
};

const config = {
  purchase_order: {
    orderTable: 'ims_purchase_orders', itemTable: 'ims_purchase_order_items', paymentTable: 'ims_purchase_order_payments', orderId: 'po_id',
    contactId: 'supplier_id', numberField: 'po_number', creditTable: 'ims_supplier_credit_notes', creditItemTable: 'ims_supplier_credit_note_items',
    creditIdField: 'supplier_credit_note_id', numberPrefix: 'SCN', numberColumn: 'scn_number',
  },
  sales_order: {
    orderTable: 'ims_sales_orders', itemTable: 'ims_sales_order_items', paymentTable: 'ims_sales_order_payments', orderId: 'so_id',
    contactId: 'customer_id', numberField: 'so_number', creditTable: 'ims_credit_notes', creditItemTable: 'ims_credit_note_items',
    creditIdField: 'customer_credit_note_id', numberPrefix: 'CN', numberColumn: 'cn_number',
  },
} as const;

function creditLines(preview: Extract<PersistedEarlyPaymentDiscountPreview, { available: true }>, taxTreatment: string) {
  const taxableNet = preview.taxableDiscountNetCents / 100;
  const taxableTax = preview.discountTaxCents / 100;
  const taxRate = taxableNet > 0 ? taxableTax / taxableNet : 0;
  return [
    ...(taxableNet > 0 ? [{ name: 'Early-payment discount', amount: taxTreatment === 'inc_tax' ? taxableNet + taxableTax : taxableNet, taxRate }] : []),
    ...(preview.taxFreeDiscountCents > 0 ? [{ name: 'Early-payment discount - tax free', amount: preview.taxFreeDiscountCents / 100, taxRate: 0 }] : []),
  ];
}

export async function applyEarlyPaymentDiscountWithPayment(input: {
  businessId: string;
  documentType: DocumentType;
  documentId: number;
  operationKey: string;
  payment: PaymentInput;
  appliedBy?: number | null;
}): Promise<EarlyPaymentApplicationResult> {
  if (!input.operationKey || input.operationKey.length > 191) throw new Error('A valid early-payment operation key is required.');
  const table = config[input.documentType];
  const pool = getIMSPool();
  const conn = await pool.getConnection();
  const numberLock = `ims:early-payment:${table.numberPrefix}:${input.businessId}`;
  let hasNumberLock = false;
  try {
    const [[lockResult]] = await conn.execute<any[]>('SELECT GET_LOCK(?, 10) AS acquired', [numberLock]);
    if (Number(lockResult?.acquired) !== 1) throw new Error('Could not allocate an early-payment credit note number. Please retry.');
    hasNumberLock = true;
    await conn.beginTransaction();

    const [[existing]] = await conn.execute<any[]>(
      `SELECT * FROM ims_early_payment_discount_applications WHERE business_id = ? AND document_type = ? AND document_id = ? FOR UPDATE`,
      [input.businessId, input.documentType, input.documentId],
    );
    if (existing) {
      if (existing.operation_key !== input.operationKey || !existing.settlement_payment_id) {
        throw new Error('An early-payment discount application already exists for this order.');
      }
      await conn.commit();
      return {
        applicationId: Number(existing.id),
        payment: { id: Number(existing.settlement_payment_id) },
        creditNoteId: Number(existing[table.creditIdField]),
        preview: {
          available: true,
          hasRule: true,
          name: '', cutoffDate: String(existing.cutoff_date).slice(0, 10),
          taxableDiscountNetCents: Math.round(Number(existing.discount_taxable_net) * 100),
          taxFreeDiscountCents: Math.round(Number(existing.discount_tax_free) * 100),
          discountNetCents: Math.round(Number(existing.discount_net) * 100),
          discountTaxCents: Math.round(Number(existing.discount_tax) * 100),
          discountGrossCents: Math.round(Number(existing.discount_gross) * 100),
          discountedSettlementCents: 0, paidByCutoffCents: Math.round(Number(existing.paid_by_cutoff) * 100),
          proposedPaymentCents: 0, remainingSettlementCents: 0, excessSettlementCents: 0, eligible: true,
        },
        replayed: true,
      };
    }

    const [[order]] = await conn.execute<any[]>(
      `SELECT * FROM ${table.orderTable} WHERE id = ? AND business_id = ? FOR UPDATE`,
      [input.documentId, input.businessId],
    );
    if (!order) throw new Error('Order not found.');
    const [items] = await conn.execute<any[]>(`SELECT line_total, tax_rate FROM ${table.itemTable} WHERE ${table.orderId} = ?`, [input.documentId]);
    const [payments] = await conn.execute<any[]>(`SELECT payment_date, amount FROM ${table.paymentTable} WHERE business_id = ? AND ${table.orderId} = ? FOR UPDATE`, [input.businessId, input.documentId]);
    const preview = previewPersistedEarlyPaymentDiscountOrder({ ...order, items, payments }, {
      paymentDate: input.payment.paymentDate,
      amount: input.payment.amount,
    });
    if (!preview.available || !preview.eligible || preview.discountGrossCents <= 0) {
      throw new Error('This payment does not qualify for the saved early-payment discount.');
    }

    const [paymentResult] = await conn.execute(
      `INSERT INTO ${table.paymentTable}
        (business_id, ${table.orderId}, payment_date, amount, currency_code, exchange_rate, amount_local, notes, payment_method_id, xero_post_intent, xero_post_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.businessId, input.documentId, input.payment.paymentDate, input.payment.amount, input.payment.currencyCode,
       input.payment.exchangeRate, input.payment.amount * input.payment.exchangeRate, input.payment.notes ?? null,
       input.payment.paymentMethodId ?? null, input.payment.xeroPostIntent,
       input.payment.xeroPostIntent === 'post_to_xero' ? 'pending' : 'not_requested'],
    );
    const paymentId = Number((paymentResult as any).insertId);

    const [[numberRow]] = await conn.execute<any[]>(
      `SELECT MAX(CAST(REGEXP_REPLACE(${table.numberColumn}, '[^0-9]', '') AS UNSIGNED)) AS max_num FROM ${table.creditTable} WHERE business_id = ?`,
      [input.businessId],
    );
    const creditNumber = `${table.numberPrefix}-${(Number(numberRow?.max_num ?? 0) + 1).toString().padStart(5, '0')}`;
    let creditNoteId: number;
    if (input.documentType === 'sales_order') {
      const [creditResult] = await conn.execute(
        `INSERT INTO ims_credit_notes
          (business_id,cn_number,customer_id,so_id,original_so_number,location_id,status,source,settlement_method,settlement_status,
           cn_date,completed_at,reference,tax_treatment,tax_code,subtotal,tax_amount,total_amount,notes,created_by)
         VALUES (?,?,?,?,?,?,'complete','manual','external','complete',?,NOW(),?,?,?,?,?,?,?,?)`,
        [input.businessId, creditNumber, order.customer_id ?? null, input.documentId, order.so_number, order.location_id,
         input.payment.paymentDate, `Early-payment discount for ${order.so_number}`, order.tax_treatment ?? 'ex_tax', order.tax_code ?? null,
         preview.discountNetCents / 100, preview.discountTaxCents / 100, preview.discountGrossCents / 100,
         `${preview.name}; cutoff ${preview.cutoffDate}`, input.appliedBy == null ? null : String(input.appliedBy)],
      );
      creditNoteId = Number((creditResult as any).insertId);
      for (const line of creditLines(preview, order.tax_treatment ?? 'ex_tax')) {
        await conn.execute(
          `INSERT INTO ims_credit_note_items (cn_id,code,name,qty,unit_price,price_basis,restock,tax_rate,line_total) VALUES (?,NULL,?,1,?,'custom',0,?,?)`,
          [creditNoteId, line.name, line.amount, line.taxRate, line.amount],
        );
      }
    } else {
      const [creditResult] = await conn.execute(
        `INSERT INTO ims_supplier_credit_notes
          (business_id,scn_number,supplier_id,po_id,location_id,status,scn_date,completed_at,reference,supplier_credit_ref,
           currency_code,exchange_rate,tax_treatment,subtotal,tax_amount,total_amount,notes,created_by)
         VALUES (?,?,?,?,?,'complete',?,NOW(),?,?,?,?,?,?,?,?,?,?)`,
        [input.businessId, creditNumber, order.supplier_id ?? null, input.documentId, order.location_id,
         input.payment.paymentDate, `Early-payment discount for ${order.po_number}`, null,
         order.currency_code ?? 'AUD', order.exchange_rate ?? 1, order.tax_treatment ?? 'ex_tax',
         preview.discountNetCents / 100, preview.discountTaxCents / 100, preview.discountGrossCents / 100,
         `Contractual terms: ${preview.name}; cutoff ${preview.cutoffDate}`, input.appliedBy == null ? null : String(input.appliedBy)],
      );
      creditNoteId = Number((creditResult as any).insertId);
      for (const line of creditLines(preview, order.tax_treatment ?? 'ex_tax')) {
        await conn.execute(
          `INSERT INTO ims_supplier_credit_note_items (scn_id,code,name,qty,unit_cost,restock,tax_rate,line_total) VALUES (?,NULL,?,1,?,0,?,?)`,
          [creditNoteId, line.name, line.amount, line.taxRate, line.amount],
        );
      }
    }

    const [applicationResult] = await conn.execute(
      `INSERT INTO ims_early_payment_discount_applications
        (business_id,document_type,document_id,settlement_payment_id,operation_key,status,cutoff_date,paid_by_cutoff,
         discount_taxable_net,discount_tax_free,discount_net,discount_tax,discount_gross,currency_code,${table.creditIdField},applied_by,applied_at)
       VALUES (?,?,?,?,?,'applied',?,?,?,?,?,?,?,?,?,?,NOW())`,
      [input.businessId, input.documentType, input.documentId, paymentId, input.operationKey, preview.cutoffDate,
       preview.paidByCutoffCents / 100, preview.taxableDiscountNetCents / 100, preview.taxFreeDiscountCents / 100,
       preview.discountNetCents / 100, preview.discountTaxCents / 100, preview.discountGrossCents / 100,
       input.payment.currencyCode, creditNoteId, input.appliedBy ?? null],
    );
    await conn.commit();
    return { applicationId: Number((applicationResult as any).insertId), payment: { id: paymentId }, creditNoteId, preview, replayed: false };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    if (hasNumberLock) await conn.execute('SELECT RELEASE_LOCK(?)', [numberLock]).catch(() => {});
    conn.release();
  }
}

export async function reconcileEarlyPaymentDiscountXero(input: {
  businessId: string;
  documentType: DocumentType;
  documentId: number;
  applicationId: number;
  creditNoteId: number;
  discountGrossCents: number;
  operationKey: string;
}): Promise<{ creditNoteId: string; allocationId: string }> {
  try {
    let xeroDocumentId: string | null = null;
    let xeroCreditNoteId: string | null = null;
    if (input.documentType === 'sales_order') {
      const order = await ImsSORepo.get(input.documentId, input.businessId);
      const creditNote = await ImsCNRepo.get(input.creditNoteId, input.businessId);
      xeroDocumentId = order?.xero_invoice_id ?? null;
      if (!creditNote) throw new Error('The early-payment customer credit note could not be reloaded.');
      xeroCreditNoteId = await syncCNAsCreditNote(input.businessId, creditNote as any, 'AUTHORISED');
    } else {
      const order = await ImsPORepo.get(input.documentId, input.businessId);
      const creditNote = await ImsSupplierCNRepo.get(input.creditNoteId, input.businessId);
      xeroDocumentId = (order as any)?.xero_bill_id ?? null;
      if (!creditNote) throw new Error('The early-payment supplier credit note could not be reloaded.');
      xeroCreditNoteId = await syncSupplierCNAsCreditNote(input.businessId, creditNote as any);
      if (xeroCreditNoteId && !await approveCreditNote(input.businessId, xeroCreditNoteId, input.creditNoteId, 'scn_credit_note')) {
        throw new Error('Xero did not Authorise the supplier early-payment credit note.');
      }
    }
    if (!xeroDocumentId) throw new Error('The source Xero invoice or bill could not be resolved after posting the payment.');
    if (!xeroCreditNoteId) throw new Error('Xero did not create the early-payment credit note.');
    const allocationId = await allocateXeroCreditNote({
      businessId: input.businessId,
      creditNoteId: xeroCreditNoteId,
      invoiceId: xeroDocumentId,
      amount: input.discountGrossCents / 100,
      actionKey: `${input.operationKey}:allocation`,
    });
    await imsExecute(
      `UPDATE ims_early_payment_discount_applications
          SET status = 'xero_complete', xero_credit_note_id = ?, xero_allocation_id = ?, xero_status = 'complete', xero_error = NULL
        WHERE id = ? AND business_id = ?`,
      [xeroCreditNoteId, allocationId, input.applicationId, input.businessId],
    );
    return { creditNoteId: xeroCreditNoteId, allocationId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Xero early-payment reconciliation failed.';
    await imsExecute(
      `UPDATE ims_early_payment_discount_applications SET status = 'xero_failed', xero_status = 'failed', xero_error = ? WHERE id = ? AND business_id = ?`,
      [message.slice(0, 500), input.applicationId, input.businessId],
    ).catch(() => {});
    throw error;
  }
}

export async function markEarlyPaymentDiscountXeroFailure(
  businessId: string,
  applicationId: number,
  message: string,
): Promise<void> {
  await imsExecute(
    `UPDATE ims_early_payment_discount_applications SET status = 'xero_failed', xero_status = 'failed', xero_error = ? WHERE id = ? AND business_id = ?`,
    [message.slice(0, 500), applicationId, businessId],
  );
}