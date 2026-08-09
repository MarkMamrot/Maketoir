import { createHash } from 'crypto';
import { getIMSPool } from '@/services/IMSMySQLService';
import { ImsCNRepo, ImsSORepo } from '@/lib/ims/ImsRepository';
import { getXeroInvoiceFinancialState } from '@/services/XeroSyncService';
import { calculateOutstandingLines, calculateOutstandingTotals, classifyAccountingResolution, allowedCreditSettlements, type OrderResolutionOutcome, type CreditSettlement } from './domain';
import { nextBackorderNumber } from '../backorders/domain';

export async function previewCustomerResolution(businessId: string, soId: number, outcome: OrderResolutionOutcome) {
  const so: any = await ImsSORepo.get(soId, businessId);
  if (!so) throw new Error('Sales order not found.');
  if (so.status !== 'partially_fulfilled') throw new Error('Only partially fulfilled sales orders have an outstanding remainder to resolve.');
  if (so.shopify_order_id || String(so.so_type).toLowerCase() !== 'b2b') throw new Error('Only manual wholesale sales orders are supported.');
  const rawLines = calculateOutstandingLines((so.items ?? []).map((item: any) => ({
    itemId: Number(item.id), orderedQuantity: Number(item.qty_ordered), actualQuantity: Number(item.qty_fulfilled ?? 0),
    unitAmount: Number(item.unit_price), discountPct: Number(item.discount_pct ?? 0), taxRate: Number(item.tax_rate ?? 0),
  })), so.tax_treatment ?? 'ex_tax');
  if (!rawLines.length) throw new Error('This sales order has no outstanding quantity.');
  const lines = rawLines.map(line => { const item=(so.items??[]).find((candidate:any)=>Number(candidate.id)===line.itemId); return {
    ...line, variantId:item?.variant_id??null, code:item?.sku??null, name:item?.product_name??item?.name??'Outstanding item',
  }; });
  const totals = calculateOutstandingTotals(lines);
  let xero: any = null;
  if (so.xero_invoice_id) xero = await getXeroInvoiceFinancialState(businessId, String(so.xero_invoice_id));
  const accounting = classifyAccountingResolution(outcome, {
    documentId: so.xero_invoice_id ?? null,
    status: xero?.status ?? null,
    amountPaid: Number(xero?.amountPaid ?? 0),
    amountCredited: Number(xero?.amountCredited ?? 0),
    quantitiesEditable: ['DRAFT','AUTHORISED'].includes(String(xero?.status ?? '').toUpperCase()),
  });
  return {
    soId, outcome, lines, totals, accounting,
    settlements: allowedCreditSettlements(outcome, accounting),
    xero,
    childAllowed: outcome === 'create_backorder',
    currencyCode: String(so.currency_code ?? xero?.currencyCode ?? 'AUD').toUpperCase(),
    taxTreatment: String(so.tax_treatment ?? 'ex_tax') as 'ex_tax'|'inc_tax'|'no_tax',
  };
}

function totals(items: any[], treatment: string, freight: number, discount: number) {
  let subtotal = 0, tax = 0;
  for (const item of items) {
    const line = Number(item.qty_ordered) * Number(item.unit_price) * (1 - Number(item.discount_pct ?? 0) / 100);
    const rate = Number(item.tax_rate ?? 0);
    if (treatment === 'inc_tax' && rate > 0) { const ex = line / (1 + rate); subtotal += ex; tax += line - ex; }
    else { subtotal += line; if (treatment === 'ex_tax') tax += line * rate; }
  }
  subtotal = Math.round(subtotal * 100) / 100; tax = treatment === 'no_tax' ? 0 : Math.round(tax * 100) / 100;
  return { subtotal, tax, total: Math.round((subtotal + tax + freight - discount) * 100) / 100 };
}

export async function resolveCustomerOutstanding(input: {
  businessId: string; soId: number; operationKey: string; outcome: OrderResolutionOutcome;
  settlement: CreditSettlement; accountCode?: string; preview: Awaited<ReturnType<typeof previewCustomerResolution>>; createdBy?: string;
}) {
  const requestHash = createHash('sha256').update(JSON.stringify({ soId: input.soId, outcome: input.outcome, settlement: input.settlement, lines: input.preview.lines.map(l => [l.itemId, l.actualQuantity]) })).digest('hex');
  const conn = await getIMSPool().getConnection();
  let resolutionId = 0, childSoId: number | null = null, childSoNumber: string | null = null;
  try {
    await conn.beginTransaction();
    await conn.execute(`INSERT IGNORE INTO ims_so_shortfall_resolutions
      (business_id,operation_key,request_hash,source_so_id,outcome,settlement,outstanding_amount,currency_code,accounting_action)
      VALUES (?,?,?,?,?,?,?,?,?)`, [input.businessId,input.operationKey,requestHash,input.soId,input.outcome,input.settlement,input.preview.totals.totalAmount,input.preview.currencyCode,
      input.preview.accounting.kind === 'create_credit_note' ? 'credit_note' : input.preview.accounting.kind === 'resize_xero_document' ? 'resize_document' : 'none']);
    const [[resolution]] = await conn.execute<any[]>(`SELECT * FROM ims_so_shortfall_resolutions WHERE business_id=? AND operation_key=? FOR UPDATE`, [input.businessId,input.operationKey]);
    if (!resolution || String(resolution.request_hash) !== requestHash) throw new Error('The operation key was already used with different resolution choices.');
    if (resolution.state === 'complete' && resolution.response_json) { await conn.commit(); return typeof resolution.response_json === 'string' ? JSON.parse(resolution.response_json) : resolution.response_json; }
    resolutionId = Number(resolution.id);
    const [[so]] = await conn.execute<any[]>(`SELECT * FROM ims_sales_orders WHERE id=? AND business_id=? FOR UPDATE`, [input.soId,input.businessId]);
    if (!so || so.status !== 'partially_fulfilled') throw new Error('The sales order is no longer partially fulfilled. Refresh and preview again.');
    const [items] = await conn.execute<any[]>(`SELECT * FROM ims_sales_order_items WHERE so_id=? ORDER BY id FOR UPDATE`, [input.soId]);
    const outstanding = items.filter(i => Number(i.qty_ordered) - Number(i.qty_fulfilled ?? 0) > 0);
    if (!outstanding.length) throw new Error('The sales order has no outstanding quantity.');
    const lockedFingerprint = outstanding.map(item => [Number(item.id),Number(item.qty_ordered),Number(item.qty_fulfilled??0),Number(item.unit_price),Number(item.discount_pct??0),Number(item.tax_rate??0)]);
    const previewFingerprint = input.preview.lines.map(line => [line.itemId,line.orderedQuantity,line.actualQuantity,line.unitAmount,line.discountPct,line.taxRate]);
    if (JSON.stringify(lockedFingerprint) !== JSON.stringify(previewFingerprint)) throw new Error('The outstanding quantities or prices changed after preview. Refresh and try again.');

    if (input.outcome === 'leave_partial') {
      const response = { resolutionId, sourceSoId: input.soId, outcome: input.outcome, state: 'complete' };
      await conn.execute(`UPDATE ims_so_shortfall_resolutions SET state='complete',response_json=?,completed_at=NOW() WHERE id=?`, [JSON.stringify(response),resolutionId]);
      await conn.commit(); return response;
    }
    if (input.outcome === 'create_backorder') {
      const [numbers] = await conn.execute<any[]>(`SELECT so_number FROM ims_sales_orders WHERE so_number LIKE ?`, [`${so.so_number}-B%`]);
      childSoNumber = nextBackorderNumber(so.so_number, numbers.map(n => n.so_number));
      const childItems = outstanding.map(i => ({ ...i, qty_ordered: Number(i.qty_ordered)-Number(i.qty_fulfilled ?? 0) }));
      const childTotals = totals(childItems, so.tax_treatment, 0, 0);
      const [child] = await conn.execute<any>(`INSERT INTO ims_sales_orders
        (business_id,so_number,so_type,customer_id,customer_po_number,location_id,status,order_date,expected_date,notes,payment_terms,price_tier,tax_treatment,tax_code,freight,discount,subtotal,tax_amount,total_amount)
        VALUES (?,?, 'b2b',?,?,?,'backordered',CURDATE(),?,?,?,?,?,?,0,0,?,?,?)`,
        [input.businessId,childSoNumber,so.customer_id,so.customer_po_number,so.location_id,so.expected_date,`Outstanding remainder from ${so.so_number}`,so.payment_terms,so.price_tier,so.tax_treatment,so.tax_code,childTotals.subtotal,childTotals.tax,childTotals.total]);
      childSoId = Number(child.insertId);
      for (const item of childItems) {
        const line = item.qty_ordered * Number(item.unit_price) * (1-Number(item.discount_pct??0)/100);
        const [created] = await conn.execute<any>(`INSERT INTO ims_sales_order_items (so_id,variant_id,qty_ordered,unit_price,discount_pct,tax_rate,line_total,notes) VALUES (?,?,?,?,?,?,?,?)`,
          [childSoId,item.variant_id,item.qty_ordered,item.unit_price,item.discount_pct??0,item.tax_rate??0,line,item.notes??null]);
        const sourceSnapshot = JSON.stringify({
          variantId: item.variant_id ?? null,
          sku: item.sku ?? null,
          name: item.product_name ?? item.name ?? 'Outstanding item',
          orderedQuantity: Number(item.qty_ordered),
          fulfilledQuantity: Number(item.qty_fulfilled ?? 0),
          transferredQuantity: Number(item.qty_ordered) - Number(item.qty_fulfilled ?? 0),
          unitPrice: Number(item.unit_price),
          discountPct: Number(item.discount_pct ?? 0),
          taxRate: Number(item.tax_rate ?? 0),
          notes: item.notes ?? null,
        });
        await conn.execute(`INSERT INTO ims_so_backorder_lines (business_id,operation_key,source_so_id,source_so_item_id,backorder_so_id,backorder_so_item_id,transferred_qty,source_item_snapshot) VALUES (?,?,?,?,?,?,?,?)`,
          [input.businessId,input.operationKey,input.soId,item.id,childSoId,created.insertId,item.qty_ordered,sourceSnapshot]);
      }
    } else {
      for (const item of outstanding) {
        const qty = Number(item.qty_ordered)-Number(item.qty_fulfilled??0);
        await conn.execute(`UPDATE ims_stock SET qty_committed=GREATEST(0,qty_committed-?) WHERE variant_id=? AND location_id=?`, [qty,item.variant_id,so.location_id]);
      }
    }
    const actualItems: any[] = [];
    for (const item of items) {
      const fulfilled = Number(item.qty_fulfilled??0);
      if (fulfilled <= 0) await conn.execute(`DELETE FROM ims_sales_order_items WHERE id=?`, [item.id]);
      else { const line=fulfilled*Number(item.unit_price)*(1-Number(item.discount_pct??0)/100); await conn.execute(`UPDATE ims_sales_order_items SET qty_ordered=?,line_total=? WHERE id=?`,[fulfilled,line,item.id]); actualItems.push({...item,qty_ordered:fulfilled}); }
    }
    const sourceTotals=totals(actualItems,so.tax_treatment,Number(so.freight??0),Number(so.discount??0));
    await conn.execute(`UPDATE ims_sales_orders SET status='fulfilled',fulfilled_date=COALESCE(fulfilled_date,CURDATE()),subtotal=?,tax_amount=?,total_amount=? WHERE id=?`,[sourceTotals.subtotal,sourceTotals.tax,sourceTotals.total,input.soId]);
    await conn.execute(`UPDATE ims_so_shortfall_resolutions SET child_so_id=?,state='xero_pending' WHERE id=?`,[childSoId,resolutionId]);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }

  let creditNoteId: number | null = null;
  if (input.preview.accounting.kind === 'create_credit_note') {
    const so: any = await ImsSORepo.get(input.soId,input.businessId);
    creditNoteId = await ImsCNRepo.create({ location_id:so.location_id,cn_date:new Date().toISOString().slice(0,10),reference:`Outstanding remainder ${so.so_number}`,
      tax_treatment:so.tax_treatment==='inc_tax'?'inc_tax':'ex_tax',tax_code:so.tax_code,notes:'No-restock shortfall credit',customer_id:so.customer_id,so_id:input.soId,
      original_so_number:so.so_number,source:'so_shortfall',settlement_method:'external' }, input.preview.lines.map((line:any)=>({
        variant_id:line.variantId??null,code:line.code??null,name:line.name??'Outstanding item',qty:line.outstandingQuantity,
        unit_price:line.unitAmount*(1-line.discountPct/100),price_basis:'custom' as const,restock:false,tax_rate:input.preview.taxTreatment==='no_tax'?0:line.taxRate })), input.businessId,input.createdBy);
    await ImsCNRepo.complete(creditNoteId,input.businessId);
  }
  const actionType = input.settlement === 'reserve_for_backorder' ? 'reserve_for_order' : input.settlement;
  const response={resolutionId,sourceSoId:input.soId,childSoId,childSoNumber,creditNoteId,outcome:input.outcome,settlement:input.settlement,state:'xero_pending'};
  const pool=getIMSPool(); const finish=await pool.getConnection(); try {
    await finish.beginTransaction();
    if (creditNoteId) {
      await finish.execute(`UPDATE ims_so_shortfall_resolutions SET credit_note_id=? WHERE id=?`,[creditNoteId,resolutionId]);
      await finish.execute(`INSERT IGNORE INTO ims_customer_credit_settlements (business_id,resolution_id,action_key,action_type,amount,target_so_id,account_code,status) VALUES (?,?,?,?,?,?,?,'planned')`,
        [input.businessId,resolutionId,`${input.operationKey}:${actionType}`,actionType,input.preview.totals.totalAmount,childSoId,input.accountCode?.trim() || null]);
    }
    await finish.execute(`UPDATE ims_so_shortfall_resolutions SET response_json=? WHERE id=?`,[JSON.stringify(response),resolutionId]); await finish.commit();
  } catch(e){await finish.rollback();throw e;} finally{finish.release();}
  return response;
}