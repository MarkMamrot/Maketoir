
(Get-Content -Path 'src/app/api/inventory/order-planner/route.ts' -Raw) -replace '(?s)async function loadContext\(databaseId: string\) \{.*?let authHeader = '''';', 'async function loadContext(databaseId: string) {
  const inventorySystemId = await resolveInventorySystemId(databaseId);
  const source = (await ConfigRepository.get(databaseId, ''inventory_source'').catch(() => null)) ?? ''cin7'';

  let products: ProductRow[] = [];
  let stock: StockRow[] = [];
  let suppliers: SupplierRow[] = [];
  let branches: BranchRow[] = [];

  if (source === ''solvantis'') {
    try {
      const imsProducts = await imsQuery<any>(
        "SELECT p.id as p_id, p.product_id, p.name as p_name, p.brand, p.supplier_contact_id, p.created_at, " +
        "v.variant_id, v.sku, v.option1_value, v.option2_value, v.option3_value, v.pack_size, v.cost, " +
        "c.sales_qty_7d, c.sales_qty_90d, c.sales_qty_180d, c.sales_qty_12m, " +
        "c.global_soh, c.global_available, c.global_incoming " +
        "FROM ims_products p " +
        "JOIN ims_variants v ON p.product_id = v.product_id " +
        "LEFT JOIN ims_sales_cache c ON v.variant_id = c.variant_id " +
        "WHERE p.is_active = 1"
      );
      products = imsProducts.map(row => ({
        business_id: databaseId,
        cin7_id: String(row.product_id),
        option_id: String(row.variant_id),
        code: row.sku,
        name: row.p_name,
        brand: row.brand,
        supplier_id: row.supplier_contact_id ? String(row.supplier_contact_id) : null,
        option_label: [row.option1_value, row.option2_value, row.option3_value].filter(Boolean).join('' '') || null,
        pack_size: row.pack_size,
        cost: row.cost,
        created_date: row.created_at,
        global_soh: row.global_soh || 0,
        global_available: row.global_available || 0,
        global_incoming: row.global_incoming || 0,
        sales_qty_7d: row.sales_qty_7d || 0,
        sales_qty_90d: row.sales_qty_90d || 0,
        sales_qty_180d: row.sales_qty_180d || 0,
        sales_qty_12m: row.sales_qty_12m || 0,
      } as ProductRow));

      const imsStock = await imsQuery<any>(
        "SELECT s.variant_id, s.location_id, s.qty_on_hand, s.qty_committed, s.qty_incoming, v.sku, p.name as p_name, l.name as loc_name " +
        "FROM ims_stock s " +
        "JOIN ims_variants v ON s.variant_id = v.variant_id " +
        "JOIN ims_products p ON v.product_id = p.product_id " +
        "LEFT JOIN ims_locations l ON s.location_id = l.id"
      );
      stock = imsStock.map(row => ({
        business_id: databaseId,
        product_option_id: String(row.variant_id),
        branch_id: String(row.location_id),
        branch_name: row.loc_name || null,
        code: row.sku,
        name: row.p_name,
        soh: row.qty_on_hand || 0,
        available: (row.qty_on_hand || 0) - (row.qty_committed || 0),
        incoming: row.qty_incoming || 0,
        reorder_point: 0,
        reorder_qty: 0,
        last_synced_at: null,
      } as StockRow));

      const imsSuppliers = await imsQuery<any>(
        "SELECT id, name, company, email, phone, country, lead_time_days FROM ims_contacts WHERE type = ''Supplier'' AND is_active = 1"
      );
      suppliers = imsSuppliers.map(row => ({
        business_id: databaseId,
        cin7_id: String(row.id),
        name: row.company || row.name,
        contact_name: row.name,
        email: row.email,
        phone: row.phone,
        country: row.country,
        lead_time_days: row.lead_time_days,
        last_synced_at: null,
      } as SupplierRow));

      const imsLocations = await imsQuery<any>("SELECT id, name, is_active FROM ims_locations");
      branches = imsLocations.map(row => ({
        business_id: databaseId,
        cin7_id: String(row.id),
        name: row.name,
        is_active: row.is_active === 1,
        last_synced_at: null,
      } as BranchRow));

    } catch (e) {
      console.error(''Failed to load Solvantis IMS data for planner'', e);
    }
  } else {
    const [p, s, sp, b] = await Promise.all([
      ProductsRepository.list(inventorySystemId).catch(() => [] as ProductRow[]),
      StockRepository.list(inventorySystemId).catch(() => [] as StockRow[]),
      SuppliersRepository.list(inventorySystemId).catch(() => [] as SupplierRow[]),
      BranchesRepository.list(inventorySystemId).catch(() => [] as BranchRow[]),
    ]);
    products = p; stock = s; suppliers = sp; branches = b;
  }

  let authHeader = '''';' | Set-Content -Path 'src/app/api/inventory/order-planner/route.ts'

