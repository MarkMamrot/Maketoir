import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { query } from '../src/services/MySQLService';
import { getIMSPool } from '../src/services/IMSMySQLService';
import { runImsForBusiness } from '../src/lib/db/BusinessRegistry';
import { initializeLayby } from '../src/lib/pos/laybyRepository';
import { xeroApiFetch } from '../src/services/XeroService';
import { refreshVariantCache } from '../src/lib/ims/cacheHelper';
import { reportRuntimeIssue } from '../src/lib/runtimeIssues';

const businessId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const saleId = 586370;
const invoiceId = '8a8ac48e-0a17-46ad-9798-3275218bfca6';
const narration = 'POS layby #586370 deposit reclassification - 2026-10-07';
const apply = process.argv.includes('--apply');

async function main() {
  const businesses = await query<any>('SELECT ims_db_name, is_sandbox FROM businesses WHERE business_id = ? AND deleted_at IS NULL', [businessId]);
  assert.equal(businesses.length, 1);
  assert.equal(businesses[0].ims_db_name, 'readyedu_MonsterthreadsIMS');
  assert.equal(Number(businesses[0].is_sandbox), 0);
  return runImsForBusiness(businessId, async () => {
    const connection = await getIMSPool().getConnection();
    let journalId: string | null = null;
    let variants: string[] = [];
    try {
      await connection.beginTransaction();
      const [sales]: any = await connection.execute('SELECT * FROM pos_sales WHERE id = ? AND business_id = ? FOR UPDATE', [saleId, businessId]);
      const sale = sales[0];
      assert.ok(sale && sale.local_id === 'e0599af4-6708-4a1e-adfd-2464fa0adb28' && sale.sale_type === 'layby' && sale.status === 'layby_active');
      assert.equal(Number(sale.total), 129.95);
      assert.equal(Number(sale.location_id), 1);
      assert.equal(Number(sale.register_session_id), 322);
      assert.equal(sale.completed_at, null);
      const [payments]: any = await connection.execute('SELECT * FROM pos_payments WHERE sale_id = ? ORDER BY id FOR UPDATE', [saleId]);
      assert.equal(payments.length, 1);
      assert.equal(Number(payments[0].id), 13061);
      assert.equal(Number(payments[0].amount), 26);
      assert.equal(payments[0].payment_method, 'Card');
      const [items]: any = await connection.execute('SELECT * FROM pos_sale_items WHERE sale_id = ? FOR UPDATE', [saleId]);
      assert.equal(items.length, 1);
      assert.equal(items[0].code, 'PSN1703');
      assert.equal(Number(items[0].qty), 1);
      variants = items.map((item: any) => item.variant_id);
      const [ledgers]: any = await connection.execute('SELECT * FROM pos_laybys WHERE sale_id = ? AND business_id = ? FOR UPDATE', [saleId, businessId]);
      if (ledgers.length) {
        assert.equal(ledgers[0].state, 'active');
        assert.equal(Number(ledgers[0].paid_total), 26);
        const [events]: any = await connection.execute("SELECT xero_status,xero_id FROM pos_layby_events WHERE sale_id = ? AND business_id = ? AND kind = 'receipt'", [saleId, businessId]);
        assert.equal(events.length, 1);
        assert.equal(events[0].xero_status, 'posted');
        journalId = events[0].xero_id;
        assert.ok(journalId);
        const [reservations]: any = await connection.execute('SELECT quantity,released_at FROM pos_layby_reservations WHERE sale_id = ? AND business_id = ?', [saleId, businessId]);
        assert.equal(reservations.length, 1);
        assert.equal(Number(reservations[0].quantity), 1);
        assert.equal(reservations[0].released_at, null);
        const verified = (await xeroApiFetch(businessId, `/ManualJournals/${journalId}`)).ManualJournals?.[0];
        assert.equal(verified?.Narration, narration);
        assert.equal(verified?.Status, 'POSTED');
        await connection.rollback();
        return { alreadyCorrected: true, journalId, paid: 26, balance: 103.95, reserved: 1 };
      }
      const [stocks]: any = await connection.execute('SELECT qty_on_hand,qty_committed FROM ims_stock WHERE variant_id = ? AND location_id = 1 FOR UPDATE', [variants[0]]);
      assert.equal(stocks.length, 1);
      assert.equal(Number(stocks[0].qty_on_hand), 1);
      assert.equal(Number(stocks[0].qty_committed), 0);
      const original = (await xeroApiFetch(businessId, `/Invoices/${invoiceId}`)).Invoices?.[0];
      assert.equal(original?.Status, 'PAID');
      assert.equal(Number(original.Total), 1006.72);
      assert.equal(Number(original.TotalTax), 91.52);
      assert.equal(Number(original.AmountPaid), 1006.72);
      assert.equal(original.LineAmountTypes, 'Inclusive');
      assert.equal(original.LineItems.length, 1);
      assert.equal(original.LineItems[0].AccountCode, '41002');
      const mappings = await query<any>('SELECT role_key,xero_account_id,xero_account_code FROM xero_account_mappings WHERE business_id = ? AND role_key IN (?, ?)', [businessId, 'layby_liability', 'pos_sales_revenue:1']);
      assert.equal(mappings.find(mapping => mapping.role_key === 'layby_liability')?.xero_account_code, '21600');
      assert.equal(mappings.find(mapping => mapping.role_key === 'pos_sales_revenue:1')?.xero_account_code, '41002');
      const accounts = (await xeroApiFetch(businessId, '/Accounts')).Accounts;
      assert.ok(accounts.some((account: any) => account.Code === '21600' && account.Class === 'LIABILITY' && account.Status === 'ACTIVE'));
      const existing = (await xeroApiFetch(businessId, `/ManualJournals?where=${encodeURIComponent(`Narration==${JSON.stringify(narration)}`)}`)).ManualJournals ?? [];
      assert.ok(existing.length <= 1, 'Multiple corrections found; reconcile manually');
      journalId = existing[0]?.ManualJournalID ?? null;
      if (existing.length) assert.equal(existing[0].Status, 'POSTED');
      if (!apply) {
        await connection.rollback();
        return { dryRun: true, journalId, revenueDebit: 23.64, gstDebit: 2.36, liabilityCredit: 26, reserveQuantity: 1 };
      }
      if (!journalId) {
        const response = await xeroApiFetch(businessId, '/ManualJournals', {
          method: 'POST', idempotencyKey: createHash('sha256').update(`${businessId}|layby|${saleId}|historical-deposit-reclass-v1`).digest('hex'),
          body: { ManualJournals: [{ Narration: narration, Date: '2026-10-07', Status: 'POSTED', LineAmountTypes: 'Inclusive',
            JournalLines: [
              { AccountCode: '41002', LineAmount: 26, TaxType: 'OUTPUT', Description: 'Reverse deposit sales and GST', Tracking: original.LineItems[0].Tracking ?? [] },
              { AccountCode: '21600', LineAmount: -26, TaxType: 'NONE', Description: 'Uncollected layby deposit liability' },
            ] }] },
        });
        journalId = response.ManualJournals?.[0]?.ManualJournalID;
        assert.ok(journalId, 'Posted journal ID missing; retry this script, not a new journal');
      }
      const journal = (await xeroApiFetch(businessId, `/ManualJournals/${journalId}`)).ManualJournals?.[0];
      assert.equal(journal?.Status, 'POSTED');
      assert.equal(journal.Narration, narration);
      const debit = journal.JournalLines.find((line: any) => line.AccountCode === '41002');
      const credit = journal.JournalLines.find((line: any) => line.AccountCode === '21600');
      assert.equal(Number(debit?.TaxAmount), 2.36);
      assert.ok([23.64, 26].includes(Number(debit.LineAmount)));
      assert.equal(Number(credit?.LineAmount), -26);
      await initializeLayby(connection, sale, items, payments, { businessId, locationId: 1, registerId: 1, registerSessionId: 322, cashierId: sale.cashier_id }, String(sale.created_at));
      await connection.execute('UPDATE pos_laybys SET fee_percent = 0 WHERE sale_id = ? AND business_id = ?', [saleId, businessId]);
      await connection.execute("UPDATE pos_layby_events SET xero_status = 'posted', xero_id = ?, reason = ? WHERE sale_id = ? AND business_id = ? AND kind = 'receipt'", [journalId, `Deposit in original invoice ${invoiceId}; reclassified by approved journal`, saleId, businessId]);
      await connection.execute(`INSERT INTO pos_layby_events (business_id,sale_id,operation_key,kind,amount,location_id,register_id,register_session_id,reason,created_at,xero_status,xero_id)
        VALUES (?, ?, ?, 'cancellation', 0, 1, 1, 322, ?, ?, 'posted', ?)`, [businessId, saleId, `adopt:${saleId}`, 'Approved historical adoption; no payment or refund', sale.created_at, journalId]);
      await connection.execute('UPDATE pos_sales SET notes = CONCAT_WS(CHAR(10), NULLIF(notes, ?), ?) WHERE id = ? AND business_id = ?', ['', `2026-10-07 approved layby adoption: reserved 1 unit; retained AUD 26 deposit and AUD 103.95 balance; Xero reclassification ${journalId}. No charge or refund.`, saleId, businessId]);
      await connection.commit();
      await refreshVariantCache(variants);
      return { applied: true, journalId, paid: 26, balance: 103.95, reserved: 1, stockOnHand: 1 };
    } catch (error) {
      await connection.rollback();
      if (apply) await reportRuntimeIssue({ businessId, source: 'layby_reconciliation', operation: 'historical_deposit', title: 'Historical layby correction needs reconciliation', error, context: { journalId }, reference: { type: 'pos_sale', id: saleId } });
      throw error;
    } finally { connection.release(); }
  });
}
main().then(result => { console.log(JSON.stringify(result)); process.exit(0); }, error => { console.error(error.message); process.exit(1); });