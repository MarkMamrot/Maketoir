import type { RowDataPacket } from 'mysql2/promise';
import { execute, query } from '@/services/MySQLService';

interface AssetRow extends RowDataPacket {
  asset_id: string;
  business_id: string;
  stored_filename: string;
  mime_type: string;
  byte_size: number;
  original_name: string;
  alt_text: string | null;
  created_by_user_id: number | null;
  created_by_name: string | null;
  created_at: Date | string;
}

export interface WholesalePortalAsset {
  assetId: string;
  url: string;
  mimeType: string;
  byteSize: number;
  originalName: string;
  altText: string | null;
  createdBy: { userId: number | null; name: string | null };
  createdAt: string;
}

export interface WholesalePortalStoredAsset extends WholesalePortalAsset {
  businessId: string;
  storedFilename: string;
}

function mapAsset(row: AssetRow): WholesalePortalStoredAsset {
  const date = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  return {
    assetId: row.asset_id,
    businessId: row.business_id,
    storedFilename: row.stored_filename,
    url: `/api/wholesale/layout-assets/${row.asset_id}`,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    originalName: row.original_name,
    altText: row.alt_text,
    createdBy: { userId: row.created_by_user_id, name: row.created_by_name },
    createdAt: Number.isNaN(date.getTime()) ? '' : date.toISOString(),
  };
}

const columns = `asset_id, business_id, stored_filename, mime_type, byte_size, original_name,
                 alt_text, created_by_user_id, created_by_name, created_at`;
const aliasedColumns = `a.asset_id, a.business_id, a.stored_filename, a.mime_type, a.byte_size, a.original_name,
                        a.alt_text, a.created_by_user_id, a.created_by_name, a.created_at`;

export const WholesalePortalAssetRepository = {
  async findOwnedActiveIds(businessId: string, assetIds: readonly string[]): Promise<Set<string>> {
    const ids = [...new Set(assetIds)];
    if (!ids.length) return new Set();
    const rows = await query<{ asset_id: string } & RowDataPacket>(
      `SELECT asset_id FROM wholesale_portal_assets
        WHERE business_id = ? AND is_active = 1 AND asset_id IN (${ids.map(() => '?').join(',')})`,
      [businessId, ...ids],
    );
    return new Set(rows.map(row => row.asset_id));
  },

  async listOwned(businessId: string): Promise<WholesalePortalAsset[]> {
    const rows = await query<AssetRow>(
      `SELECT ${columns} FROM wholesale_portal_assets
        WHERE business_id = ? AND is_active = 1 ORDER BY created_at DESC, asset_id DESC`,
      [businessId],
    );
    return rows.map(row => {
      const { businessId: _businessId, storedFilename: _storedFilename, ...asset } = mapAsset(row);
      return asset;
    });
  },

  async create(input: {
    assetId: string;
    businessId: string;
    storedFilename: string;
    mimeType: string;
    byteSize: number;
    originalName: string;
    altText: string | null;
    actor: { userId: number; name: string };
  }): Promise<WholesalePortalAsset> {
    await execute(
      `INSERT INTO wholesale_portal_assets
         (asset_id, business_id, stored_filename, mime_type, byte_size, original_name,
          alt_text, created_by_user_id, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.assetId, input.businessId, input.storedFilename, input.mimeType, input.byteSize,
        input.originalName, input.altText, input.actor.userId, input.actor.name],
    );
    const rows = await query<AssetRow>(`SELECT ${columns} FROM wholesale_portal_assets WHERE asset_id = ? AND business_id = ? LIMIT 1`, [input.assetId, input.businessId]);
    if (!rows[0]) throw new Error('Uploaded wholesale layout asset could not be reloaded.');
    const { businessId: _businessId, storedFilename: _storedFilename, ...asset } = mapAsset(rows[0]);
    return asset;
  },

  async getPublicActive(assetId: string): Promise<WholesalePortalStoredAsset | null> {
    const rows = await query<AssetRow>(
      `SELECT ${aliasedColumns}
         FROM wholesale_portal_assets a
         JOIN wholesale_supplier_profiles p ON p.business_id = a.business_id AND p.is_active = 1
        WHERE a.asset_id = ? AND a.is_active = 1 LIMIT 1`,
      [assetId],
    );
    return rows[0] ? mapAsset(rows[0]) : null;
  },
};
