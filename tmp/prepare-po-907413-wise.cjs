require('dotenv').config({ quiet: true });
require('tsx/cjs');
const crypto = require('crypto');
const { query } = require('../src/services/MySQLService.ts');
const { runImsForBusiness } = require('../src/lib/db/BusinessRegistry.ts');
const { getIMSPool } = require('../src/services/IMSMySQLService.ts');
const { xeroApiFetch } = require('../src/services/XeroService.ts');
const { reportRuntimeIssue } = require('../src/lib/runtimeIssues.ts');

const invoiceId = 'f4b794f9-7bb0-4f44-8e34-fb7f2b55ddcc';
const wiseId = 'f9b899b5-919c-442d-be2e-3a6de42d29fc';
const auditOperation = 'user_authorised_wise_repost_preparation';
const expected = {
  2: { amount: 3086, rate: 1.391789, local: 4295.0609, date: '2026-05-15', status: 'posted', xeroId: '549f6b83-ee10-428f-abcf-a4a1d047b8e3', actionStatus: 'succeeded' },
  3: { amount: 3000, rate: 1.4021, local: 4206.3, date: '2026-09-11', status: 'pending', xeroId: null, actionStatus: 'pending' },
};
const deletedIds = ['251c3779-1bc3-42ca-84b9-90c264881096', 'da8d8319-2e27-4dc2-b871-b429d5a4ef69', expected[2].xeroId];
let businessId;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function prepare() {
  const businesses = await query('SELECT business_id, ims_db_name FROM businesses WHERE name=? AND is_sandbox=0 AND deleted_at IS NULL', ['Monsterthreads']);
  assert(businesses.length === 1, 'Ambiguous production business');
  businessId = businesses[0].business_id;
  const accounts = await xeroApiFetch(businessId, '/Accounts', { method: 'GET' });
  const wise = accounts?.Accounts?.find(account => account.AccountID === wiseId);
  assert(wise?.Name === 'Wise' && wise.Status === 'ACTIVE' && wise.Type === 'BANK' && wise.CurrencyCode === 'AUD', 'Wise is not the verified active AUD bank');
  for (const deletedId of deletedIds) {
    const response = await xeroApiFetch(businessId, `/Payments/${deletedId}`, { method: 'GET' });
    const payment = response?.Payments?.[0];
    assert(payment?.Status === 'DELETED' && payment.Invoice?.InvoiceID === invoiceId, 'A previous Xero payment is not verified deleted on this bill');
  }
  const organisations = await xeroApiFetch(businessId, '/Organisation', { method: 'GET' });
  assert(organisations?.Organisations?.[0]?.BaseCurrency === 'AUD', 'Xero base currency is not AUD');

  await runImsForBusiness(businessId, async () => {
    const connection = await getIMSPool().getConnection();
    const mainSchema = connection.escapeId(process.env.MYSQL_DATABASE);
    try {
      await connection.beginTransaction();
      const [schema] = await connection.query('SELECT DATABASE() AS name');
      assert(schema[0].name === businesses[0].ims_db_name, 'Tenant schema mismatch');
      const [orders] = await connection.execute('SELECT id, po_number, xero_bill_id FROM ims_purchase_orders WHERE business_id=? AND id=2804 FOR UPDATE', [businessId]);
      assert(orders.length === 1 && orders[0].po_number === 'PO-907413' && orders[0].xero_bill_id === invoiceId, 'Purchase order identity changed');
      const [methods] = await connection.execute('SELECT id, name, type, xero_account_code FROM ims_payment_methods WHERE business_id=? AND id=2 FOR UPDATE', [businessId]);
      assert(methods.length === 1 && methods[0].name === 'Bank Transfer International WIse' && methods[0].type === 'po' && ['Wise ()', wiseId].includes(methods[0].xero_account_code), 'Wise payment method changed');
      const [payments] = await connection.execute('SELECT * FROM ims_purchase_order_payments WHERE business_id=? AND po_id=2804 ORDER BY id FOR UPDATE', [businessId]);
      assert(payments.length === 2, 'Purchase order payment set changed');
      const plans = [];
      for (const payment of payments) {
        const previous = expected[payment.id];
        assert(previous && payment.payment_method_id === 1 && payment.currency_code === 'USD' && Number(payment.amount) === previous.amount && Number(payment.exchange_rate) === previous.rate && Number(payment.amount_local) === previous.local && payment.payment_date === previous.date && payment.xero_post_status === previous.status && payment.xero_payment_id === previous.xeroId, 'Recorded payment financial or posting state changed');
        const operationKey = `po-payment:2804:${payment.id}`;
        const body = { Payments: [{ Invoice: { InvoiceID: invoiceId }, Account: { AccountID: wiseId }, Amount: Math.round(Number(payment.amount) * 100) / 100, Date: payment.payment_date, CurrencyRate: 1 / Number(payment.exchange_rate) }] };
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ operationKey, body, currencyCode: payment.currency_code })).digest('hex');
        const [actions] = await connection.execute(`SELECT * FROM ${mainSchema}.xero_accounting_actions WHERE business_id=? AND operation_key=? FOR UPDATE`, [businessId, operationKey]);
        assert(actions.length === 1 && actions[0].status === previous.actionStatus && actions[0].xero_id === previous.xeroId && actions[0].action_type === 'po_payment' && actions[0].source_type === 'po_payment' && String(actions[0].source_id) === String(payment.id), 'Accounting action changed or is not safe to reset');
        plans.push({ payment, action: actions[0], fingerprint });
      }
      const invoiceResponse = await xeroApiFetch(businessId, `/Invoices/${invoiceId}`, { method: 'GET' });
      const invoice = invoiceResponse?.Invoices?.[0];
      assert(invoice?.Type === 'ACCPAY' && invoice.Status === 'AUTHORISED' && invoice.CurrencyCode === 'USD' && Number(invoice.Total) === 6086 && Number(invoice.AmountDue) === 6086 && Number(invoice.AmountPaid) === 0 && Number(invoice.AmountCredited ?? 0) === 0, 'Bill is not unpaid and ready for both payments');
      console.log(JSON.stringify({ apply: process.argv.includes('--apply'), po: orders[0].po_number, wise_account_id: wiseId, bill_amount_due: invoice.AmountDue, payments: plans.map(({ payment, action, fingerprint }) => ({ id: payment.id, amount: payment.amount, currency: payment.currency_code, exchange_rate: payment.exchange_rate, previous_payment_method_id: payment.payment_method_id, new_payment_method_id: 2, previous_status: payment.xero_post_status, previous_xero_id: payment.xero_payment_id, action_status: action.status, prepared_fingerprint: fingerprint })) }, null, 2));
      if (!process.argv.includes('--apply')) {
        await connection.rollback();
        return;
      }
      await connection.execute('UPDATE ims_payment_methods SET xero_account_code=? WHERE business_id=? AND id=2', [wiseId, businessId]);
      for (const { payment, action, fingerprint } of plans) {
        const audit = { operation: auditOperation, local_payment_id: payment.id, previous_payment_method_id: payment.payment_method_id, new_payment_method_id: 2, previous_method_account_reference: methods[0].xero_account_code, new_account_id: wiseId, previous_xero_payment_id: payment.xero_payment_id, verified_deleted_payment_ids: deletedIds, previous_action_fingerprint: action.request_fingerprint, new_action_fingerprint: fingerprint, previous_payment_status: payment.xero_post_status, previous_action_status: action.status, previous_attempt_count: action.attempt_count, payment_amount: payment.amount, currency: payment.currency_code, saved_exchange_rate: payment.exchange_rate, posting_performed: false };
        await connection.execute(`INSERT INTO ${mainSchema}.xero_sync_log (business_id,sync_type,reference_id,xero_id,status,xero_state,detail) VALUES (?,?,?,?,?,?,?)`, [businessId, 'po_payment', 2804, payment.xero_payment_id, 'skipped', 'DELETED', JSON.stringify(audit)]);
        const [actionUpdate] = await connection.execute(`UPDATE ${mainSchema}.xero_accounting_actions SET status='pending',request_fingerprint=?,xero_id=NULL,safe_error=?,completed_at=NULL WHERE id=? AND business_id=? AND status=? AND request_fingerprint=? AND xero_id <=> ?`, [fingerprint, 'User authorised Wise retry after verified provider deletion; no payment posted.', action.id, businessId, action.status, action.request_fingerprint, action.xero_id]);
        const [paymentUpdate] = await connection.execute("UPDATE ims_purchase_order_payments SET payment_method_id=2,xero_post_intent='post_to_xero',xero_post_status='pending',xero_payment_id=NULL,xero_post_error=NULL,xero_posted_at=NULL WHERE business_id=? AND po_id=2804 AND id=? AND payment_method_id=1 AND xero_post_status=? AND xero_payment_id <=> ?", [businessId, payment.id, payment.xero_post_status, payment.xero_payment_id]);
        assert(actionUpdate.affectedRows === 1 && paymentUpdate.affectedRows === 1, 'Conditional retry update failed');
      }
      await connection.commit();
      console.log('Committed Wise mapping and exactly two payment/action resets with audit records. No Xero payment write performed.');
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
}

prepare().then(() => process.exit(0)).catch(async error => {
  if (businessId && error.code) await reportRuntimeIssue({ businessId, source: 'support_reconciliation', operation: auditOperation, title: 'Wise payment retry preparation failed', error, context: { purchaseOrderId: 2804 } }).catch(() => {});
  console.error(error.code || error.message);
  process.exit(1);
});