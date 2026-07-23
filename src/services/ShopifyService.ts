// src/services/ShopifyService.ts
import Shopify from 'shopify-api-node';
import { StandardizedProduct } from '../types/StandardizedData';

export class ShopifyService {
  private shopify: Shopify;
  private readonly shopName_: string;
  private readonly accessToken_: string;

  constructor(shopName: string, accessToken: string) {
    this.shopify       = new Shopify({ shopName, accessToken });
    this.shopName_     = shopName;
    this.accessToken_  = accessToken;
  }

  // ── Gift Card API (REST) ────────────────────────────────────────────────────
  // Uses raw fetch — shopify-api-node doesn't expose the `code` field on create.

  private async gcFetch(method: string, path: string, body?: object): Promise<any> {
    const res = await fetch(
      `https://${this.shopName_}/admin/api/2024-04${path}`,
      {
        method,
        headers: { 'X-Shopify-Access-Token': this.accessToken_, 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify ${res.status} ${method} ${path}: ${text.slice(0, 300)}`);
    }
    return res.json();
  }

  /**
   * Creates a new gift card in Shopify.
   * The full `code` is ONLY returned at creation time — store it immediately.
   */
  async createGiftCard(opts: {
    initial_value: number | string;
    code?:         string;           // provide to activate a pre-printed physical card
    note?:         string;
    customer_id?:  number | null;
    expires_on?:   string | null;    // YYYY-MM-DD, null = Shopify default (3 yrs)
  }): Promise<{
    id:              number;
    code:            string;
    last_characters: string;
    initial_value:   string;
    balance:         string;
    currency:        string;
    expires_on:      string | null;
    line_item_id:    number | null;
  }> {
    const payload: Record<string, any> = { initial_value: String(opts.initial_value) };
    if (opts.code)        payload.code        = opts.code;
    if (opts.note)        payload.note        = opts.note;
    if (opts.customer_id) payload.customer_id = opts.customer_id;
    if (opts.expires_on)  payload.expires_on  = opts.expires_on;
    const data = await this.gcFetch('POST', '/gift_cards.json', { gift_card: payload });
    return data.gift_card;
  }

  /** Disables (permanently cancels) a Shopify gift card. Cannot be undone. */
  async disableGiftCard(shopifyGcId: number): Promise<void> {
    await this.gcFetch('POST', `/gift_cards/${shopifyGcId}/disable.json`, {});
  }

  /**
   * Finds active gift cards matching the last 4 characters of a code.
   * Shopify never returns the full code after creation — this is the only way
   * to look up a card by code at redemption time.
   */
  async findGiftCardsByLastChars(last4: string): Promise<Array<{
    id:              number;
    balance:         string;
    initial_value:   string;
    currency:        string;
    expires_on:      string | null;
    last_characters: string;
    disabled_at:     string | null;
    customer_id:     number | null;
    order_id:        number | null;
    line_item_id:    number | null;
    note:            string | null;
  }>> {
    // Fetch enabled cards and filter client-side (Shopify doesn't support last_characters as query param)
    const all = await this.getAllGiftCards('enabled');
    return all.filter(c => (c.last_characters ?? '').toLowerCase() === last4.toLowerCase());
  }

  /**
   * Fetches all gift cards for the given status with cursor-based pagination.
   * status: 'enabled' | 'disabled'
   */
  async getAllGiftCards(status: 'enabled' | 'disabled' = 'enabled'): Promise<any[]> {
    const results: any[] = [];
    let url: string | null = `https://${this.shopName_}/admin/api/2024-04/gift_cards.json?status=${status}&limit=250`;
    while (url) {
      const res: Response = await fetch(url, {
        headers: { 'X-Shopify-Access-Token': this.accessToken_, 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Shopify ${res.status} GET gift_cards: ${text.slice(0, 300)}`);
      }
      const data = await res.json();
      results.push(...(data.gift_cards ?? []));
      const link: string = res.headers.get('link') ?? '';
      const nextMatch: RegExpMatchArray | null = link.match(/<([^>]+)>;\s*rel="next"/);
      url = nextMatch ? nextMatch[1] : null;
    }
    return results;
  }

  // Phase 1 + Phase 2 Features

  /**
   * Syncs the initial product catalog into Marketoir ecosystem.
   * This forms the baseline 'Brand DNA' mapping and gross margin setup.
   */
  async getCatalog(): Promise<StandardizedProduct[]> {
    const rawProducts = await this.shopify.product.list({ limit: 250 });
    
    // Map Shopify object to Marketoir StandardizedProduct format
    return rawProducts.map((prod: any) => ({
      id: prod.id,
      platformId: prod.id,
      name: prod.title,
      category: prod.product_type,
      price: parseFloat(prod.variants?.[0]?.price || '0'),
      // Example default setup, cost and grossMargin will be set in UI
      cost: 0,
      grossMargin: 0,
      imageUrl: prod.image?.src
    }));
  }

  /**
   * Live inventory check across Shopify API to avoid scaling ads 
   * for out-of-stock items (Data to Pull Dynamically).
   */
  async checkInventory(productId: string): Promise<number> {
    const prod = await this.shopify.product.get(parseInt(productId, 10));
    // Assume simplistic stock mapping for now
    let totalStock = 0;
    if (prod.variants) {
      prod.variants.forEach((v: any) => totalStock += v.inventory_quantity);
    }
    return totalStock;
  }

  // ── Static sheet headers (must match column order used by sync/shopify) ──────
  static readonly PRODUCT_HEADERS = [
    'id', 'variant_id', 'handle', 'title', 'status', 'product_type', 'vendor', 'tags',
    'description_html', 'price', 'compare_at_price', 'sku', 'barcode', 'inventory_qty',
    'weight', 'image_url', 'variant_count', 'image_count', 'published_at', 'updated_at',
  ];

  /** Paginated fetch — handles stores with >250 products. */
  async getAllProducts(): Promise<any[]> {
    const products: any[] = [];
    let params: any = { limit: 250 };
    while (true) {
      const page = await (this.shopify as any).product.list(params) as any;
      products.push(...(page as any[]));
      // Prefer cursor-based pagination when available (Link header present)
      const next = page.nextPageParameters as any | undefined;
      if (next) {
        params = next;
      } else if ((page as any[]).length >= 250) {
        // Fallback: since_id for stores where cursor isn't returned
        params = { limit: 250, since_id: (page as any[])[(page as any[]).length - 1].id };
      } else {
        break;
      }
    }
    return products;
  }

  /**
   * Fetches all orders created on or after `sinceDate` (ISO date string, e.g. '2026-07-01').
   * Returns full order objects including line_items, financial_status, fulfillment_status.
   */
  async getAllOrders(sinceDate: string): Promise<any[]> {
    const orders: any[] = [];
    let params: any = { status: 'any', created_at_min: sinceDate, limit: 250 };
    while (true) {
      const page = await (this.shopify as any).order.list(params) as any[];
      orders.push(...page);
      const next = (page as any).nextPageParameters;
      if (next) {
        params = next;
      } else if (page.length >= 250) {
        params = { ...params, since_id: page[page.length - 1].id };
        delete params.created_at_min; // since_id is the cursor from here
      } else {
        break;
      }
    }
    return orders;
  }

  /** Map a Shopify product object to a flat row matching PRODUCT_HEADERS. */
  toSheetRow(product: any): string[] {
    const v = product.variants?.[0] ?? {};
    return [
      String(product.id ?? ''),
      String(v.id ?? ''),
      product.handle ?? '',
      product.title ?? '',
      product.status ?? '',
      product.product_type ?? '',
      product.vendor ?? '',
      Array.isArray(product.tags) ? product.tags.join(', ') : (product.tags ?? ''),
      product.body_html ?? '',
      String(v.price ?? ''),
      String(v.compare_at_price ?? ''),
      String(v.sku ?? ''),
      String(v.barcode ?? ''),
      String(v.inventory_quantity ?? 0),
      String(v.weight ?? ''),
      product.image?.src ?? '',
      String(product.variants?.length ?? 0),
      String(product.images?.length ?? 0),
      product.published_at ?? '',
      product.updated_at ?? '',
    ];
  }

  async updateProduct(id: number | string, updates: Record<string, any>): Promise<void> {
    await this.shopify.product.update(Number(id), updates);
  }

  /** Fetch a single product (with variants + images) by id. */
  async getProduct(id: number | string): Promise<any> {
    return (this.shopify as any).product.get(Number(id));
  }

  /** Create a product image from a source URL or base64 attachment. */
  async createProductImage(productId: number | string, image: { src?: string; attachment?: string; alt?: string; position?: number }): Promise<any> {
    return (this.shopify as any).productImage.create(Number(productId), image);
  }

  /** Fetch human order names (e.g. "#47497") for a set of Shopify order ids. */
  async getOrderNames(ids: (string | number)[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const unique = Array.from(new Set(ids.map(String))).filter(Boolean);
    for (let i = 0; i < unique.length; i += 250) {
      const batch = unique.slice(i, i + 250);
      const orders = await (this.shopify as any).order.list({
        ids: batch.join(','),
        fields: 'id,name,order_number',
        status: 'any',
        limit: 250,
      });
      for (const o of (orders ?? [])) {
        map.set(String(o.id), String(o.name ?? (o.order_number ? `#${o.order_number}` : '')));
      }
    }
    return map;
  }

  /** List all Shopify locations (id, name, active). */
  async listLocations(): Promise<Array<{ id: number; name: string; active: boolean }>> {
    const locs = await (this.shopify as any).location.list();
    return (locs ?? []).map((l: any) => ({ id: Number(l.id), name: String(l.name ?? ''), active: !!l.active }));
  }

  /** Set the absolute available quantity for an inventory item at a location. */
  async setInventoryLevel(inventoryItemId: number | string, locationId: number | string, available: number): Promise<void> {
    await (this.shopify as any).inventoryLevel.set({
      inventory_item_id: Number(inventoryItemId),
      location_id: Number(locationId),
      available: Math.round(available),
    });
  }

  /**
   * Set absolute "available" quantities for MANY inventory items at one location
   * in a single GraphQL call (up to 250 per call). Far faster than looping the
   * REST endpoint — a 250-item batch is one round-trip instead of 250.
   * Requires the write_inventory scope. Returns { count, userErrors }.
   */
  async setInventoryLevelsBulk(
    items: Array<{ inventoryItemId: number | string; available: number }>,
    locationId: number | string,
  ): Promise<{ count: number; userErrors: Array<{ field?: string[]; message: string }> }> {
    if (!items.length) return { count: 0, userErrors: [] };
    const locGid = `gid://shopify/Location/${Number(locationId)}`;
    const quantities = items.map(it => ({
      inventoryItemId: `gid://shopify/InventoryItem/${Number(it.inventoryItemId)}`,
      locationId: locGid,
      quantity: Math.round(it.available),
    }));

    const query = `mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        userErrors { field message }
      }
    }`;
    const variables = {
      input: {
        name: 'available',
        reason: 'correction',
        ignoreCompareQuantity: true,
        quantities,
      },
    };

    const res: any = await (this.shopify as any).graphql(query, variables);
    const userErrors = res?.inventorySetQuantities?.userErrors ?? [];
    return { count: items.length, userErrors };
  }

  /**
   * Get location IDs where an inventory item is tracked.
   * Uses inventory_levels endpoint — requires write_inventory scope only
   * (no read_locations needed). Returns an empty array if the item isn't tracked.
   */
  async getInventoryLocationsForItem(inventoryItemId: number | string): Promise<number[]> {
    try {
      const levels = await (this.shopify as any).inventoryLevel.list({
        inventory_item_ids: String(inventoryItemId),
        limit: 50,
      });
      return (levels ?? []).map((l: any) => Number(l.location_id)).filter(Boolean);
    } catch { return []; }
  }

  // ── Shopify Payments payouts (requires read_shopify_payments_payouts scope) ──

  /**
   * List Shopify Payments payouts, newest first.
   * @param params e.g. { limit, status: 'paid', date_min, date_max, since_id }
   */
  async listPayouts(params: Record<string, any> = {}): Promise<any[]> {
    const list = await (this.shopify as any).payout.list({ limit: 50, ...params });
    return (list ?? []) as any[];
  }

  /** Get a single payout by id (includes the summary breakdown). */
  async getPayout(id: number | string): Promise<any> {
    return (this.shopify as any).payout.get(Number(id));
  }

  /**
   * List balance transactions (charges/refunds/fees/adjustments) that make up a
   * payout. Filter by { payout_id } to reconcile a payout to individual orders.
   * Each row: { id, type, amount, fee, net, source_type, source_id,
   * source_order_id, source_order_transaction_id, payout_id, payout_status }.
   */
  async listBalanceTransactions(params: Record<string, any> = {}): Promise<any[]> {
    const rows = await (this.shopify as any).balance.transactions({ limit: 250, ...params });
    return (rows ?? []) as any[];
  }

  async updateVariant(id: number | string, updates: Record<string, any>): Promise<void> {
    await (this.shopify as any).productVariant.update(Number(id), updates);
  }

  /**
   * Update prices for ALL variants of one Shopify product in a single GraphQL
   * call using `productVariantsBulkUpdate`. Far faster than one REST call per
   * variant — ideal for syncing large catalogues.
   */
  async bulkUpdateVariantPrices(
    shopifyProductId: string,
    variants: Array<{ shopify_variant_id: string; price: string; compare_at_price: string | null }>,
  ): Promise<{ userErrors: Array<{ field: string[]; message: string }> }> {
    if (!variants.length) return { userErrors: [] };
    const mutation = `
      mutation bulkUpdatePrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          userErrors { field message }
        }
      }`;
    const res: any = await (this.shopify as any).graphql(mutation, {
      productId: `gid://shopify/Product/${shopifyProductId}`,
      variants: variants.map(v => ({
        id:             `gid://shopify/ProductVariant/${v.shopify_variant_id}`,
        price:          v.price,
        compareAtPrice: v.compare_at_price,   // null clears the compare-at price
      })),
    });
    return { userErrors: res?.productVariantsBulkUpdate?.userErrors ?? [] };
  }

  /** Create a new product in Shopify. Returns the created product (with variants). */
  async createProduct(payload: Record<string, any>): Promise<any> {
    return (this.shopify as any).product.create(payload);
  }

  static readonly COLLECTION_HEADERS = [
    'id', 'type', 'handle', 'title', 'published', 'products_count',
    'sort_order', 'updated_at', 'url',
  ];

  /** Fetch all custom and smart collections. */
  async getAllCollections(shopDomain: string): Promise<any[]> {
    const results: any[] = [];

    // Custom collections
    let params: any = { limit: 250 };
    while (true) {
      const page = await (this.shopify as any).customCollection.list(params) as any;
      (page as any[]).forEach(c => results.push({ ...c, _type: 'custom' }));
      const next = page.nextPageParameters as any | undefined;
      if (!next) break;
      params = next;
    }

    // Smart collections
    params = { limit: 250 };
    while (true) {
      const page = await (this.shopify as any).smartCollection.list(params) as any;
      (page as any[]).forEach(c => results.push({ ...c, _type: 'smart' }));
      const next = page.nextPageParameters as any | undefined;
      if (!next) break;
      params = next;
    }

    return results.map(c => ({
      id: String(c.id ?? ''),
      type: c._type,
      handle: c.handle ?? '',
      title: c.title ?? '',
      published: c.published_at ? 'true' : 'false',
      products_count: String(c.products_count ?? ''),
      sort_order: c.sort_order ?? '',
      updated_at: c.updated_at ?? '',
      url: `https://${shopDomain}/collections/${c.handle}`,
    }));
  }

  toCollectionRow(c: { id: string; type: string; handle: string; title: string; published: string; products_count: string; sort_order: string; updated_at: string; url: string }): string[] {
    return [
      c.id, c.type, c.handle, c.title, c.published,
      c.products_count, c.sort_order, c.updated_at, c.url,
    ];
  }

  /**
   * Fetch monthly retention stats from Shopify orders.
   * For each of the last `monthsBack` months, calculates what % of orders
   * came from customers who had ordered in any prior month.
   * Uses one extra month of lookback as context so month 1 isn't over-counted.
   *
   * Returns one entry per month: { month, totalOrders, repeatOrders, retentionRate }
   */
  async getMonthlyRetentionStats(monthsBack = 12): Promise<{
    month: string;
    totalOrders: number;
    repeatOrders: number;
    retentionRate: number;
  }[]> {
    // Fetch from 1 extra month before the window to seed prior-customer context
    const windowStart = new Date();
    windowStart.setMonth(windowStart.getMonth() - (monthsBack + 1));
    windowStart.setDate(1);
    windowStart.setHours(0, 0, 0, 0);

    const orders: any[] = [];
    let params: any = {
      limit: 250,
      status: 'any',
      created_at_min: windowStart.toISOString(),
      fields: 'id,created_at,customer',
    };

    console.log(`[ShopifyService] Fetching orders since ${windowStart.toISOString().slice(0, 10)} for retention stats…`);
    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const page = await (this.shopify as any).order.list(params) as any;
      orders.push(...(page as unknown as any[]));
      console.log(`[ShopifyService] Retention page: ${page.length} orders (total so far: ${orders.length})`);
      const next = page.nextPageParameters as any | undefined;
      if (!next) break;
      params = next;
    }
    console.log(`[ShopifyService] Fetched ${orders.length} orders for retention stats.`);

    // Sort ascending by date
    orders.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    // Group into YYYY-MM buckets
    const monthBuckets = new Map<string, any[]>();
    for (const o of orders) {
      const d = new Date(o.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthBuckets.has(key)) monthBuckets.set(key, []);
      monthBuckets.get(key)!.push(o);
    }

    // Cutoff key: only return results for the last `monthsBack` months
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);
    const cutoffKey = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`;

    const seenCustomers = new Set<string>();
    const results: { month: string; totalOrders: number; repeatOrders: number; retentionRate: number }[] = [];

    for (const month of [...monthBuckets.keys()].sort()) {
      const monthOrders = monthBuckets.get(month)!;

      if (month < cutoffKey) {
        // This is the prior-context month — seed the seen set without recording results
        for (const o of monthOrders) {
          const cid = String(o.customer?.id ?? '');
          if (cid) seenCustomers.add(cid);
        }
        continue;
      }

      let totalOrders = 0;
      let repeatOrders = 0;
      for (const o of monthOrders) {
        const cid = String(o.customer?.id ?? '');
        if (!cid) continue; // guest checkout — skip
        totalOrders++;
        if (seenCustomers.has(cid)) repeatOrders++;
        // Don't add to seen yet — within-month re-orders don't count as "prior month" repeat
      }

      const retentionRate = totalOrders > 0 ? (repeatOrders / totalOrders) * 100 : 0;
      results.push({ month, totalOrders, repeatOrders, retentionRate });

      // Seed this month's customers so future months treat them as returning
      for (const o of monthOrders) {
        const cid = String(o.customer?.id ?? '');
        if (cid) seenCustomers.add(cid);
      }
    }

    return results;
  }

  // ── Static sheet headers for Shopify_Orders ────────────────────────────────
  static readonly ORDER_HEADERS = [
    'order_id', 'order_number', 'created_at', 'financial_status', 'fulfillment_status',
    'total_price', 'subtotal_price', 'total_tax', 'total_discounts', 'currency',
    'source_name', 'customer_id', 'customer_email', 'customer_first_name', 'customer_last_name',
    'customer_orders_count', 'line_items_count',
  ];

  /**
   * Fetch the last `monthsBack` months of Shopify orders for syncing to a sheet.
   * Includes the customer's lifetime order count (customer.orders_count) so
   * new-vs-returning analysis can be done in the spreadsheet.
   */
  async getOrdersForSync(monthsBack = 24): Promise<any[]> {
    const windowStart = new Date();
    windowStart.setMonth(windowStart.getMonth() - monthsBack);
    windowStart.setDate(1);
    windowStart.setHours(0, 0, 0, 0);

    const orders: any[] = [];
    let params: any = {
      limit: 250,
      status: 'any',
      created_at_min: windowStart.toISOString(),
      fields: 'id,order_number,created_at,financial_status,fulfillment_status,total_price,subtotal_price,total_tax,total_discounts,currency,source_name,customer,line_items',
    };

    console.log(`[ShopifyService] Fetching orders for sync since ${windowStart.toISOString().slice(0, 10)}…`);
    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const page = await (this.shopify as any).order.list(params) as any;
      orders.push(...(page as unknown as any[]));
      console.log(`[ShopifyService] Sync page: ${page.length} orders (total so far: ${orders.length})`);
      const next = page.nextPageParameters as any | undefined;
      if (!next) break;
      params = next;
    }
    console.log(`[ShopifyService] Fetched ${orders.length} orders for sync.`);

    // Shopify deprecated customer.orders_count from order responses in API v2022-07+.
    // Strategy: fetch the real lifetime total from the Customers API (captures orders
    // placed outside the 24-month window), then subtract the number of orders each
    // customer placed AFTER this specific order within the dataset.
    // Result = how many orders the customer had placed at the time of this order.
    const uniqueCustomerIds = [...new Set(
      orders.map(o => String(o.customer?.id ?? '')).filter(Boolean)
    )];
    const lifetimeCountById = new Map<string, number>();
    const BATCH_SIZE = 250;
    for (let i = 0; i < uniqueCustomerIds.length; i += BATCH_SIZE) {
      const batch = uniqueCustomerIds.slice(i, i + BATCH_SIZE);
      try {
        const customers: any[] = await (this.shopify as any).customer.list({
          ids: batch.join(','),
          limit: BATCH_SIZE,
          fields: 'id,orders_count',
        });
        for (const c of customers) {
          lifetimeCountById.set(String(c.id), Number(c.orders_count ?? 0));
        }
      } catch (err) {
        console.warn(`[ShopifyService] Could not fetch customer batch (ids ${batch[0]}…): ${err}`);
      }
    }

    // Build a sorted list of order timestamps per customer so we can count
    // how many of their orders in this dataset came AFTER each given order.
    const orderTimesById = new Map<string, number[]>();
    for (const o of orders) {
      const cid = String(o.customer?.id ?? '');
      if (!cid) continue;
      const ts = new Date(o.created_at).getTime();
      if (!orderTimesById.has(cid)) orderTimesById.set(cid, []);
      orderTimesById.get(cid)!.push(ts);
    }

    for (const o of orders) {
      if (!o.customer) continue;
      const cid = String(o.customer.id ?? '');
      const lifetime = lifetimeCountById.get(cid);
      if (lifetime === undefined) continue;
      const ts = new Date(o.created_at).getTime();
      const ordersAfter = (orderTimesById.get(cid) ?? []).filter(t => t > ts).length;
      o.customer.orders_count = Math.max(1, lifetime - ordersAfter);
    }

    return orders;
  }

  /** Map a Shopify order object to a flat row matching ORDER_HEADERS. */
  toOrderRow(o: any): string[] {
    return [
      String(o.id ?? ''),
      String(o.order_number ?? ''),
      o.created_at ?? '',
      o.financial_status ?? '',
      o.fulfillment_status ?? '',
      String(o.total_price ?? ''),
      String(o.subtotal_price ?? ''),
      String(o.total_tax ?? ''),
      String(o.total_discounts ?? ''),
      o.currency ?? '',
      o.source_name ?? '',
      String(o.customer?.id ?? ''),
      o.customer?.email ?? '',
      o.customer?.first_name ?? '',
      o.customer?.last_name ?? '',
      String(o.customer?.orders_count ?? ''),
      String(Array.isArray(o.line_items) ? o.line_items.length : ''),
    ];
  }
}