export const IMS_SALES_LINES_SQL = `
  SELECT COALESCE(hvid.variant_id, hsku.variant_id, hopt.variant_id) AS variant_id,
      hl.id AS location_id, NULL AS channel_instance_id, h.qty, h.line_total AS amount
    FROM ims_sales_history h
    LEFT JOIN ims_product_variants hvid ON hvid.variant_id = h.variant_id
    LEFT JOIN ims_product_variants hsku ON hvid.variant_id IS NULL AND hsku.sku = h.sku
    LEFT JOIN ims_product_variants hopt ON hvid.variant_id IS NULL AND hsku.variant_id IS NULL AND hopt.cin7_option_id = h.cin7_option_id
    LEFT JOIN ims_locations hl ON hl.cin7_branch_id = h.branch_id
   WHERE h.invoice_date BETWEEN ? AND ?

  UNION ALL

  SELECT COALESCE(pvid.variant_id, psku.variant_id) AS variant_id,
      ps.location_id, NULL AS channel_instance_id, psi.qty, psi.line_total AS amount
    FROM pos_sale_items psi
    JOIN pos_sales ps ON ps.id = psi.sale_id
    LEFT JOIN ims_product_variants pvid ON pvid.variant_id = psi.variant_id
    LEFT JOIN ims_product_variants psku ON pvid.variant_id IS NULL AND psku.sku = psi.code
   WHERE ps.status = 'completed' AND ps.sale_type = 'sale' AND ps.is_historical = 0
     AND DATE(ps.completed_at) BETWEEN ? AND ?

  UNION ALL

  SELECT COALESCE(svid.variant_id, ssku.variant_id) AS variant_id,
      so.location_id, so.channel_instance_id, soi.qty_ordered AS qty, soi.line_total AS amount
    FROM ims_sales_order_items soi
    JOIN ims_sales_orders so ON so.id = soi.so_id
    LEFT JOIN ims_product_variants svid ON svid.variant_id = soi.variant_id
    LEFT JOIN ims_product_variants ssku ON svid.variant_id IS NULL AND ssku.sku = soi.code
  WHERE so.status NOT IN ('draft', 'cancelled') AND so.is_staff_preview_test = 0 AND so.cin7_order_id IS NULL
     AND so.order_date BETWEEN ? AND ?`;
