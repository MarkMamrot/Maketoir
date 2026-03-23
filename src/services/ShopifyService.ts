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
}