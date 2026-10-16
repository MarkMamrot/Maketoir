import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { ACCOUNTING_GUIDANCE, eventAmounts, eventExceptions, safeCsvCell, type projectActivity } from './domain';

type Projection = ReturnType<typeof projectActivity>;
export async function exportConsignment(projection: Projection, format: string, title: string, identity: string[] = []) {
  const summary = [
    title, ...identity, 'Currency: AUD. Captured supplier cost is tax-exclusive; GST is shown separately.',
    `Net quantity: ${projection.totals.netQuantity}; Subtotal: ${projection.totals.subtotal.toFixed(2)}; GST: ${projection.totals.tax.toFixed(2)}; Total: ${projection.totals.total.toFixed(2)}`,
    ACCOUNTING_GUIDANCE,
    ...projection.exceptions.map(issue => `REVIEW event ${issue.eventId}: ${issue.message}`),
  ];
  if (format === 'csv') {
    const lines = [
      ...summary.map(text => [text]),
      ['Cost-grouped summary'],
      ['Supplier', 'SKU', 'Product', 'Sold', 'Refunded (net reversals)', 'Corrected quantity', 'Net quantity', 'Supplier unit cost (ex GST)', 'GST rate %', 'Subtotal', 'GST', 'Total'],
      ...projection.rows.map(row => [row.supplierId, row.sku, row.productName, row.quantitySold, row.quantityRefunded, row.quantityAdjusted, row.netQuantity, row.unitCost, row.taxRate, row.subtotal.toFixed(2), row.tax.toFixed(2), row.total.toFixed(2)]),
      ['Source evidence; supplier stock-only returns do not reduce sales dues'],
      ['Event', 'Supplier', 'Source type', 'Source reference', 'Source line', 'Original event', 'Date', 'SKU', 'Product', 'Branch', 'Channel', 'Quantity', 'Supplier unit cost (ex GST)', 'GST rate %', 'Subtotal', 'GST', 'Total', 'Exception'],
      ...projection.events.map(event => {
        const amounts = eventExceptions(event).some(issue => issue.startsWith('Missing or invalid')) ? { subtotal: 0, tax: 0, total: 0 } : eventAmounts(event);
        return [event.id, event.supplier_id, event.source_type, event.source_id, event.source_line_id, event.original_event_id, event.event_date, event.sku, event.product_name, event.location_id, event.channel, event.quantity, event.unit_cost, event.tax_rate, amounts.subtotal.toFixed(2), amounts.tax.toFixed(2), amounts.total.toFixed(2), event.exception];
      }),
    ];
    return new Response('\uFEFF' + lines.map(line => line.map(safeCsvCell).join(',')).join('\r\n'), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="consignment.csv"', 'Cache-Control': 'private, no-store' },
    });
  }
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([595, 842]); let y = 800;
  const print = (text: string) => {
    const normalized = text.normalize('NFKD').replace(/[^\x20-\x7e]/g, '?');
    const words = normalized.split(/\s+/); let line = '';
    const draw = () => {
      if (y < 40) { page = pdf.addPage([595, 842]); y = 800; }
      page.drawText(line, { x: 35, y, size: 9, font, color: rgb(0.12, 0.12, 0.12) }); y -= 14; line = '';
    };
    for (const word of words) {
      if (font.widthOfTextAtSize(`${line} ${word}`, 9) > 520 && line) draw();
      // Long source identifiers cannot be allowed to run outside the page.
      for (const part of word.match(/.{1,80}/g) ?? ['']) {
        if (font.widthOfTextAtSize(`${line} ${part}`, 9) > 520 && line) draw();
        line += `${line ? ' ' : ''}${part}`;
      }
    }
    if (line) draw();
  };
  summary.forEach(print); y -= 12;
  for (const row of projection.rows) print(`${row.sku ?? row.variantId} | ${row.productName ?? ''} | Sold ${row.quantitySold} | Refunded ${row.quantityRefunded} | Adjusted ${row.quantityAdjusted} | Net ${row.netQuantity} | Cost ${row.unitCost ?? 'MISSING'} | GST ${row.taxRate ?? 'MISSING'}% | Subtotal ${row.subtotal.toFixed(2)} | GST ${row.tax.toFixed(2)} | Total AUD ${row.total.toFixed(2)}`);
  y -= 12; print('Source evidence (supplier stock-only returns do not reduce sales dues):');
  for (const event of projection.events) print(`${event.event_date} | ${event.source_type} ${event.source_id}/${event.source_line_id} | SKU ${event.sku ?? event.variant_id} | Qty ${event.quantity} | Branch ${event.location_id ?? '-'} | ${event.channel ?? '-'} | Original ${event.original_event_id ?? '-'}${event.exception ? ` | REVIEW: ${event.exception}` : ''}`);
  return new Response(Buffer.from(await pdf.save()), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="consignment.pdf"', 'Cache-Control': 'private, no-store' },
  });
}
