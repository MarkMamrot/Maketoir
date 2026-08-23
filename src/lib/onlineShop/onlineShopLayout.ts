import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import { getPool, query } from '@/services/MySQLService';
import { createDefaultOnlineShopLayout, normalizeOnlineShopLayoutDocument } from './layout/validation';
import { ONLINE_SHOP_LAYOUT_SCHEMA_VERSION, type OnlineShopLayoutDocument } from './layout/types';

interface LayoutRow extends RowDataPacket {
  draft_json: string | OnlineShopLayoutDocument | null;
  published_json: string | OnlineShopLayoutDocument | null;
  draft_revision: number;
  published_revision: number;
  draft_updated_by_user_id: number | null;
  draft_updated_by_name: string | null;
  draft_updated_at: Date | string | null;
  published_by_user_id: number | null;
  published_by_name: string | null;
  published_at: Date | string | null;
}

export interface OnlineShopLayoutActor { userId: number; name: string }
export interface OnlineShopLayoutEditorState {
  draft: OnlineShopLayoutDocument;
  published: OnlineShopLayoutDocument;
  draftRevision: number;
  publishedRevision: number;
  draftUpdatedBy: { userId: number | null; name: string | null; at: string | null };
  publishedBy: { userId: number | null; name: string | null; at: string | null };
}

export class OnlineShopLayoutRevisionConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super('The online shop layout draft was changed by another editor.');
    this.name = 'OnlineShopLayoutRevisionConflictError';
  }
}

function parseDocument(value: LayoutRow['draft_json']): OnlineShopLayoutDocument | null {
  if (!value) return null;
  try { return normalizeOnlineShopLayoutDocument(typeof value === 'string' ? JSON.parse(value) : value); } catch { return null; }
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapState(row?: LayoutRow): OnlineShopLayoutEditorState {
  const fallback = createDefaultOnlineShopLayout();
  const published = parseDocument(row?.published_json ?? null) ?? fallback;
  return {
    draft: parseDocument(row?.draft_json ?? null) ?? published,
    published,
    draftRevision: Number(row?.draft_revision ?? 0),
    publishedRevision: Number(row?.published_revision ?? 0),
    draftUpdatedBy: { userId: row?.draft_updated_by_user_id ?? null, name: row?.draft_updated_by_name ?? null, at: iso(row?.draft_updated_at ?? null) },
    publishedBy: { userId: row?.published_by_user_id ?? null, name: row?.published_by_name ?? null, at: iso(row?.published_at ?? null) },
  };
}

async function selectForUpdate(connection: PoolConnection, businessId: string): Promise<LayoutRow | undefined> {
  const [rows] = await connection.execute<LayoutRow[]>(
    `SELECT draft_json, published_json, draft_revision, published_revision,
            draft_updated_by_user_id, draft_updated_by_name, draft_updated_at,
            published_by_user_id, published_by_name, published_at
       FROM online_shop_layouts WHERE business_id = ? FOR UPDATE`, [businessId]);
  return rows[0];
}

async function transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getPool().getConnection();
  try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result; }
  catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export const OnlineShopLayoutRepository = {
  async getPublished(businessId: string): Promise<OnlineShopLayoutDocument> {
    const rows = await query<LayoutRow>('SELECT published_json FROM online_shop_layouts WHERE business_id = ? LIMIT 1', [businessId]);
    return parseDocument(rows[0]?.published_json ?? null) ?? createDefaultOnlineShopLayout();
  },

  async getEditorState(businessId: string): Promise<OnlineShopLayoutEditorState> {
    const rows = await query<LayoutRow>(
      `SELECT draft_json, published_json, draft_revision, published_revision,
              draft_updated_by_user_id, draft_updated_by_name, draft_updated_at,
              published_by_user_id, published_by_name, published_at
         FROM online_shop_layouts WHERE business_id = ? LIMIT 1`, [businessId]);
    return mapState(rows[0]);
  },

  async saveDraft(businessId: string, document: OnlineShopLayoutDocument, expectedRevision: number, actor: OnlineShopLayoutActor): Promise<OnlineShopLayoutEditorState> {
    const normalized = normalizeOnlineShopLayoutDocument(document);
    return transaction(async connection => {
      const row = await selectForUpdate(connection, businessId);
      const currentRevision = Number(row?.draft_revision ?? 0);
      if (currentRevision !== expectedRevision) throw new OnlineShopLayoutRevisionConflictError(currentRevision);
      if (row) await connection.execute(
        `UPDATE online_shop_layouts SET schema_version = ?, draft_json = ?, draft_revision = draft_revision + 1,
          draft_updated_by_user_id = ?, draft_updated_by_name = ?, draft_updated_at = CURRENT_TIMESTAMP(3) WHERE business_id = ?`,
        [ONLINE_SHOP_LAYOUT_SCHEMA_VERSION, JSON.stringify(normalized), actor.userId, actor.name, businessId]);
      else await connection.execute(
        `INSERT INTO online_shop_layouts (business_id, schema_version, draft_json, draft_revision,
          draft_updated_by_user_id, draft_updated_by_name, draft_updated_at) VALUES (?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP(3))`,
        [businessId, ONLINE_SHOP_LAYOUT_SCHEMA_VERSION, JSON.stringify(normalized), actor.userId, actor.name]);
      return mapState(await selectForUpdate(connection, businessId));
    });
  },

  async resetDraft(businessId: string, expectedRevision: number, actor: OnlineShopLayoutActor): Promise<OnlineShopLayoutEditorState> {
    return transaction(async connection => {
      const row = await selectForUpdate(connection, businessId);
      const currentRevision = Number(row?.draft_revision ?? 0);
      if (currentRevision !== expectedRevision) throw new OnlineShopLayoutRevisionConflictError(currentRevision);
      const published = parseDocument(row?.published_json ?? null) ?? createDefaultOnlineShopLayout();
      if (row) await connection.execute(
        `UPDATE online_shop_layouts SET schema_version = ?, draft_json = ?, draft_revision = draft_revision + 1,
          draft_updated_by_user_id = ?, draft_updated_by_name = ?, draft_updated_at = CURRENT_TIMESTAMP(3) WHERE business_id = ?`,
        [ONLINE_SHOP_LAYOUT_SCHEMA_VERSION, JSON.stringify(published), actor.userId, actor.name, businessId]);
      else await connection.execute(
        `INSERT INTO online_shop_layouts (business_id, schema_version, draft_json, draft_revision,
          draft_updated_by_user_id, draft_updated_by_name, draft_updated_at) VALUES (?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP(3))`,
        [businessId, ONLINE_SHOP_LAYOUT_SCHEMA_VERSION, JSON.stringify(published), actor.userId, actor.name]);
      return mapState(await selectForUpdate(connection, businessId));
    });
  },

  async publish(businessId: string, expectedDraftRevision: number, actor: OnlineShopLayoutActor): Promise<OnlineShopLayoutEditorState> {
    return transaction(async connection => {
      const row = await selectForUpdate(connection, businessId);
      const currentRevision = Number(row?.draft_revision ?? 0);
      if (!row || currentRevision !== expectedDraftRevision) throw new OnlineShopLayoutRevisionConflictError(currentRevision);
      if (!parseDocument(row.draft_json)) throw new Error('Save an online shop layout draft before publishing.');
      await connection.execute(
        `UPDATE online_shop_layouts SET schema_version = ?, published_json = draft_json,
          published_revision = published_revision + 1, published_by_user_id = ?, published_by_name = ?,
          published_at = CURRENT_TIMESTAMP(3) WHERE business_id = ?`,
        [ONLINE_SHOP_LAYOUT_SCHEMA_VERSION, actor.userId, actor.name, businessId]);
      return mapState(await selectForUpdate(connection, businessId));
    });
  },
};