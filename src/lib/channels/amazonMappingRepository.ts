import { getIMSPool, imsExecute, imsQuery } from '@/services/IMSMySQLService';

interface AmazonMappingRow {
  mapping_id: number;
  variant_id: string | null;
  external_product_id: string | null;
  external_variant_id: string;
  mapping_status: 'linked' | 'unmatched' | 'conflict' | 'archived';
  metadata_json: string | Record<string, unknown> | null;
  last_seen_at: string | null;
  product_name: string | null;
  ims_sku: string | null;
  is_selected: number | null;
  inventory_enabled: number | null;
  price_enabled: number | null;
}

export interface AmazonMapping {
  mappingId: number;
  variantId: string | null;
  asin: string | null;
  sellerSku: string;
  status: AmazonMappingRow['mapping_status'];
  itemName: string | null;
  productName: string | null;
  imsSku: string | null;
  selected: boolean;
  inventoryEnabled: boolean;
  priceEnabled: boolean;
  lastSeenAt: string | null;
}

export interface AmazonMappingCandidate {
  variantId: string;
  productName: string;
  variantLabel: string;
  sku: string;
}

function metadata(value: AmazonMappingRow['metadata_json']): Record<string, unknown> {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export async function listAmazonMappings(input: {
  businessId: string; channelInstanceId: string; limit?: number;
}): Promise<AmazonMapping[]> {
  const rows = await imsQuery<AmazonMappingRow>(
    `SELECT mapping.id AS mapping_id, mapping.variant_id, mapping.external_product_id,
            mapping.external_variant_id, mapping.mapping_status, mapping.metadata_json, mapping.last_seen_at,
            product.name AS product_name, variant.sku AS ims_sku,
            selection.is_selected, selection.inventory_enabled, selection.price_enabled
       FROM ims_sales_channel_product_mappings mapping
       LEFT JOIN ims_product_variants variant
         ON BINARY variant.business_id = BINARY mapping.business_id AND variant.variant_id = mapping.variant_id
       LEFT JOIN ims_products product
         ON BINARY product.business_id = BINARY mapping.business_id AND product.product_id = variant.product_id
       LEFT JOIN ims_sales_channel_product_selections selection
         ON BINARY selection.business_id = BINARY mapping.business_id
        AND selection.channel_instance_id = mapping.channel_instance_id
        AND selection.variant_id = mapping.variant_id
      WHERE mapping.business_id = ? AND mapping.channel_instance_id = ?
      ORDER BY FIELD(mapping.mapping_status, 'conflict', 'unmatched', 'linked', 'archived'), mapping.external_variant_id
      LIMIT ?`,
    [input.businessId, input.channelInstanceId, Math.max(1, Math.min(1000, Math.floor(input.limit ?? 500)))],
  );
  return rows.map(row => {
    const details = metadata(row.metadata_json);
    return {
      mappingId: Number(row.mapping_id), variantId: row.variant_id, asin: row.external_product_id,
      sellerSku: row.external_variant_id, status: row.mapping_status,
      itemName: typeof details.itemName === 'string' ? details.itemName : null,
      productName: row.product_name, imsSku: row.ims_sku,
      selected: row.is_selected === 1, inventoryEnabled: row.inventory_enabled === 1,
      priceEnabled: row.price_enabled === 1, lastSeenAt: row.last_seen_at,
    };
  });
}

export async function searchAmazonMappingCandidates(input: {
  businessId: string;
  channelInstanceId: string;
  search: string;
}): Promise<AmazonMappingCandidate[]> {
  const search = input.search.trim().slice(0, 100);
  if (search.length < 2) return [];
  const term = `%${search}%`;
  const rows = await imsQuery<{ variant_id: string; product_name: string; variant_label: string; sku: string }>(
    `SELECT variant.variant_id, product.name AS product_name,
            CONCAT_WS(' / ', NULLIF(variant.option1_value, ''), NULLIF(variant.option2_value, ''), NULLIF(variant.option3_value, '')) AS variant_label,
            variant.sku
       FROM ims_product_variants variant
       JOIN ims_products product
         ON BINARY product.business_id = BINARY variant.business_id AND product.product_id = variant.product_id
       LEFT JOIN ims_sales_channel_product_mappings mapping
         ON BINARY mapping.business_id = BINARY variant.business_id AND mapping.channel_instance_id = ?
        AND mapping.variant_id = variant.variant_id AND mapping.mapping_status <> 'archived'
      WHERE variant.business_id = ? AND variant.is_active = 1 AND product.is_active = 1 AND mapping.id IS NULL
        AND (product.name LIKE ? OR variant.sku LIKE ? OR variant.barcode LIKE ?)
      ORDER BY product.name, variant.sku LIMIT 20`,
    [input.channelInstanceId, input.businessId, term, term, term],
  );
  return rows.map(row => ({ variantId: row.variant_id, productName: row.product_name,
    variantLabel: row.variant_label || 'Default', sku: row.sku }));
}

export async function createAmazonExistingAsinMapping(input: {
  businessId: string;
  channelInstanceId: string;
  variantId: string;
  asin: string;
  sellerSku: string;
}): Promise<void> {
  const asin = input.asin.trim().toUpperCase();
  const sellerSku = input.sellerSku.trim();
  if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error('Enter a valid 10-character ASIN.');
  if (!sellerSku || sellerSku.length > 40) throw new Error('Seller SKU must be between 1 and 40 characters.');
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const [variants] = await connection.execute<any[]>(
      `SELECT variant.variant_id
         FROM ims_product_variants variant
         JOIN ims_products product
           ON BINARY product.business_id = BINARY variant.business_id AND product.product_id = variant.product_id
        WHERE variant.business_id = ? AND variant.variant_id = ?
          AND variant.is_active = 1 AND product.is_active = 1 LIMIT 1 FOR UPDATE`,
      [input.businessId, input.variantId],
    );
    if (!variants[0]) throw new Error('Active IMS variant not found.');
    const [existingRows] = await connection.execute<any[]>(
      `SELECT id, variant_id, external_variant_id
         FROM ims_sales_channel_product_mappings
        WHERE business_id = ? AND channel_instance_id = ?
          AND (external_variant_id = ? OR variant_id = ?) FOR UPDATE`,
      [input.businessId, input.channelInstanceId, sellerSku, input.variantId],
    );
    const sellerMapping = existingRows.find(row => String(row.external_variant_id) === sellerSku);
    if (sellerMapping?.variant_id && String(sellerMapping.variant_id) !== input.variantId) {
      throw new Error('That seller SKU is already linked to another IMS variant.');
    }
    if (existingRows.some(row => row.variant_id && String(row.variant_id) === input.variantId
      && String(row.external_variant_id) !== sellerSku)) {
      throw new Error('That IMS variant is already linked to another seller SKU.');
    }
    if (sellerMapping) {
      await connection.execute(
        `UPDATE ims_sales_channel_product_mappings
            SET variant_id = ?, external_product_id = ?, mapping_status = 'linked',
                metadata_json = JSON_SET(COALESCE(metadata_json, JSON_OBJECT()), '$.mappingSource', 'existing_asin_offer'),
                updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND business_id = ? AND channel_instance_id = ?`,
        [input.variantId, asin, sellerMapping.id, input.businessId, input.channelInstanceId],
      );
    } else {
      await connection.execute(
        `INSERT INTO ims_sales_channel_product_mappings
           (business_id, channel_instance_id, variant_id, external_product_id, external_variant_id,
            mapping_status, metadata_json)
         VALUES (?, ?, ?, ?, ?, 'linked', JSON_OBJECT('mappingSource', 'existing_asin_offer'))`,
        [input.businessId, input.channelInstanceId, input.variantId, asin, sellerSku],
      );
    }
    await connection.execute(
      `INSERT INTO ims_sales_channel_product_selections
         (business_id, channel_instance_id, variant_id, is_selected, inventory_enabled, price_enabled)
       VALUES (?, ?, ?, 1, 1, 1)
       ON DUPLICATE KEY UPDATE is_selected = 1, inventory_enabled = 1, price_enabled = 1,
         updated_at = CURRENT_TIMESTAMP(3)`,
      [input.businessId, input.channelInstanceId, input.variantId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function setAmazonMappingControls(input: {
  businessId: string;
  channelInstanceId: string;
  mappingIds: number[];
  selected?: boolean;
  inventoryEnabled?: boolean;
  priceEnabled?: boolean;
}): Promise<number> {
  const mappingIds = [...new Set(input.mappingIds.filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 1000);
  if (mappingIds.length === 0) return 0;
  const hasChange = input.selected !== undefined || input.inventoryEnabled !== undefined || input.priceEnabled !== undefined;
  if (!hasChange) return 0;
  const placeholders = mappingIds.map(() => '?').join(',');
  const selected = input.selected ?? (input.inventoryEnabled === true || input.priceEnabled === true);
  const result = await imsExecute(
    `INSERT INTO ims_sales_channel_product_selections
       (business_id, channel_instance_id, variant_id, is_selected, inventory_enabled, price_enabled)
     SELECT mapping.business_id, mapping.channel_instance_id, mapping.variant_id, ?, ?, ?
       FROM ims_sales_channel_product_mappings mapping
      WHERE mapping.business_id = ? AND mapping.channel_instance_id = ?
        AND mapping.mapping_status = 'linked' AND mapping.variant_id IS NOT NULL
        AND mapping.id IN (${placeholders})
     ON DUPLICATE KEY UPDATE
       is_selected = ${input.selected === undefined ? 'is_selected' : 'VALUES(is_selected)'},
       inventory_enabled = ${input.inventoryEnabled === undefined ? 'inventory_enabled' : 'VALUES(inventory_enabled)'},
       price_enabled = ${input.priceEnabled === undefined ? 'price_enabled' : 'VALUES(price_enabled)'},
       updated_at = CURRENT_TIMESTAMP(3)`,
    [selected ? 1 : 0, input.inventoryEnabled === true ? 1 : 0, input.priceEnabled === true ? 1 : 0,
      input.businessId, input.channelInstanceId, ...mappingIds],
  );
  return Number(result.affectedRows ?? 0);
}
