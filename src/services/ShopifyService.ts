// src/services/ShopifyService.ts
import Shopify from 'shopify-api-node';
import { StandardizedProduct } from '../types/StandardizedData';

export class ShopifyService {
  private shopify: Shopify;

  constructor(shopName: string, accessToken: string) {
    this.shopify = new Shopify({
      shopName,
      accessToken,
    });
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

  async updateVariant(id: number | string, updates: Record<string, any>): Promise<void> {
    await (this.shopify as any).productVariant.update(Number(id), updates);
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