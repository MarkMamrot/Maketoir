import 'dotenv/config';
import mysql from 'mysql2/promise';

const businessId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const apply = process.argv.includes('--apply');
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
const auditNote = '2026-10-07 approved layby correction: removed unpaid Card allocation #13062 AUD 103.95; retained actual Card deposit #13061 AUD 26.00. No refund or stock adjustment.';

try {
  const [businesses] = await connection.execute(
    'SELECT ims_db_name FROM businesses WHERE business_id = ? AND deleted_at IS NULL AND is_sandbox = 0',
    [businessId],
  );
  if (businesses.length !== 1 || !/^\w+$/.test(businesses[0].ims_db_name)) throw new Error('Production tenant resolution failed');
  await connection.changeUser({ database: businesses[0].ims_db_name });
  await connection.beginTransaction();
  const [sales] = await connection.execute('SELECT * FROM pos_sales WHERE id = ? AND business_id = ? FOR UPDATE', [586370, businessId]);
  const sale = sales[0];
  if (!sale || sale.local_id !== 'e0599af4-6708-4a1e-adfd-2464fa0adb28' || sale.location_id !== 1
    || sale.register_session_id !== 322 || sale.customer_id !== 731 || sale.sale_type !== 'layby'
    || sale.status !== 'layby_active' || Number(sale.total) !== 129.95 || sale.completed_at !== null) {
    throw new Error('Layby identity or state changed; aborting');
  }
  const [payments] = await connection.execute('SELECT id, payment_method, amount, reference FROM pos_payments WHERE sale_id = ? ORDER BY id FOR UPDATE', [586370]);
  const deposit = payments.find(payment => payment.id === 13061);
  const unpaid = payments.find(payment => payment.id === 13062);
  if (!deposit || deposit.payment_method !== 'Card' || Number(deposit.amount) !== 26
    || payments.length !== (unpaid ? 2 : 1)
    || (unpaid && (unpaid.payment_method !== 'Card' || Number(unpaid.amount) !== 103.95 || unpaid.reference))) {
    throw new Error('Payment evidence changed; aborting');
  }
  const [items] = await connection.execute('SELECT id, code, qty, line_total FROM pos_sale_items WHERE sale_id = ? FOR UPDATE', [586370]);
  if (items.length !== 1 || items[0].code !== 'PSN1703' || Number(items[0].qty) !== 1 || Number(items[0].line_total) !== 129.95) {
    throw new Error('Merchandise evidence changed; aborting');
  }
  if (apply && unpaid) {
    const [result] = await connection.execute('DELETE FROM pos_payments WHERE id = ? AND sale_id = ? AND payment_method = ? AND amount = ?', [13062, 586370, 'Card', 103.95]);
    if (result.affectedRows !== 1) throw new Error('Correction did not remove exactly one unpaid allocation');
    await connection.execute('UPDATE pos_sales SET notes = CONCAT_WS(CHAR(10), NULLIF(notes, ?), ?) WHERE id = ? AND business_id = ?', ['', auditNote, 586370, businessId]);
  }
  const [verification] = await connection.execute('SELECT COUNT(*) AS payment_count, SUM(amount) AS paid FROM pos_payments WHERE sale_id = ?', [586370]);
  if (apply && (Number(verification[0].payment_count) !== 1 || Number(verification[0].paid) !== 26)) throw new Error('Correction verification failed');
  if (apply) await connection.commit();
  else await connection.rollback();
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', saleId: 586370, removedUnpaidAllocation: apply && Boolean(unpaid), currentPaid: Number(verification[0].paid), correctedPaid: 26, correctedBalance: 103.95, status: sale.status }));
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}