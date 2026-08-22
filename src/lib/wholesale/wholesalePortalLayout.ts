import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getPool, query } from '@/services/MySQLService';
import { createDefaultWholesaleLayout, normalizeWholesaleLayoutDocument } from './layout/validation';
import { WHOLESALE_LAYOUT_SCHEMA_VERSION, type WholesaleLayoutDocument } from './layout/types';

interface LayoutRow extends RowDataPacket {
  schema_version: number;
  draft_json: string | WholesaleLayoutDocument | null;
  published_json: string | WholesaleLayoutDocument | null;
  draft_revision: number;
  published_revision: number;
  draft_updated_by_user_id: number | null;
  draft_updated_by_name: string | null;
  draft_updated_at: Date | string | null;
  published_by_user_id: number | null;
  published_by_name: string | null;
  published_at: Date | string | null;
}

export interface WholesaleLayoutActor {
  userId: number;
  name: string;
}

export interface WholesaleLayoutEditorState {
  draft: WholesaleLayoutDocument;
  published: WholesaleLayoutDocument;
  draftRevision: number;
  publishedRevision: number;
  draftUpdatedBy: { userId: number | null; name: string | null; at: string | null };
  publishedBy: { userId: number | null; name: string | null; at: string | null };
}

export class WholesaleLayoutRevisionConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super('The wholesale layout draft was changed by another editor.');
    this.name = 'WholesaleLayoutRevisionConflictError';
  }
}

function parseDocument(value: LayoutRow['draft_json']): WholesaleLayoutDocument | null {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return normalizeWholesaleLayoutDocument(parsed);
  } catch {
    return null;
  }
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapEditorState(row?: LayoutRow): WholesaleLayoutEditorState {
  const fallback = createDefaultWholesaleLayout();
  const published = parseDocument(row?.published_json ?? null) ?? fallback;
  return {
    draft: parseDocument(row?.draft_json ?? null) ?? published,
    published,
    draftRevision: Number(row?.draft_revision ?? 0),
    publishedRevision: Number(row?.published_revision ?? 0),
    draftUpdatedBy: {
      userId: row?.draft_updated_by_user_id ?? null,
      name: row?.draft_updated_by_name ?? null,
      at: iso(row?.draft_updated_at ?? null),
    },
    publishedBy: {
      userId: row?.published_by_user_id ?? null,
      name: row?.published_by_name ?? null,
      at: iso(row?.published_at ?? null),
    },
  };
}

async function selectForUpdate(connection: PoolConnection, businessId: string): Promise<LayoutRow | undefined> {
  const [rows] = await connection.execute<LayoutRow[]>(
    `SELECT schema_version, draft_json, published_json, draft_revision, published_revision,
            draft_updated_by_user_id, draft_updated_by_name, draft_updated_at,
            published_by_user_id, published_by_name, published_at
       FROM wholesale_portal_layouts WHERE business_id = ? FOR UPDATE`,
    [businessId],
  );
  return rows[0];
}

async function inTransaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export const WholesalePortalLayoutRepository = {
  async getPublished(businessId: string): Promise<WholesaleLayoutDocument> {
    const rows = await query<LayoutRow>(
      'SELECT published_json FROM wholesale_portal_layouts WHERE business_id = ? LIMIT 1',
      [businessId],
    );
    return parseDocument(rows[0]?.published_json ?? null) ?? createDefaultWholesaleLayout();
  },

  async getEditorState(businessId: string): Promise<WholesaleLayoutEditorState> {
    const rows = await query<LayoutRow>(
      `SELECT schema_version, draft_json, published_json, draft_revision, published_revision,
              draft_updated_by_user_id, draft_updated_by_name, draft_updated_at,
              published_by_user_id, published_by_name, published_at
         FROM wholesale_portal_layouts WHERE business_id = ? LIMIT 1`,
      [businessId],
    );
    return mapEditorState(rows[0]);
  },

  async saveDraft(
    businessId: string,
    document: WholesaleLayoutDocument,
    expectedRevision: number,
    actor: WholesaleLayoutActor,
  ): Promise<WholesaleLayoutEditorState> {
    const normalized = normalizeWholesaleLayoutDocument(document);
    return inTransaction(async connection => {
      const row = await selectForUpdate(connection, businessId);
      const currentRevision = Number(row?.draft_revision ?? 0);
      if (currentRevision !== expectedRevision) throw new WholesaleLayoutRevisionConflictError(currentRevision);
      if (row) {
        await connection.execute(
          `UPDATE wholesale_portal_layouts
              SET schema_version = ?, draft_json = ?, draft_revision = draft_revision + 1,
                  draft_updated_by_user_id = ?, draft_updated_by_name = ?, draft_updated_at = CURRENT_TIMESTAMP(3)
            WHERE business_id = ?`,
          [WHOLESALE_LAYOUT_SCHEMA_VERSION, JSON.stringify(normalized), actor.userId, actor.name, businessId],
        );
      } else {
        await connection.execute(
          `INSERT INTO wholesale_portal_layouts
             (business_id, schema_version, draft_json, draft_revision,
              draft_updated_by_user_id, draft_updated_by_name, draft_updated_at)
           VALUES (?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP(3))`,
          [businessId, WHOLESALE_LAYOUT_SCHEMA_VERSION, JSON.stringify(normalized), actor.userId, actor.name],
        );
      }
      const updated = await selectForUpdate(connection, businessId);
      return mapEditorState(updated);
    });
  },

  async resetDraft(businessId: string, expectedRevision: number, actor: WholesaleLayoutActor): Promise<WholesaleLayoutEditorState> {
    return inTransaction(async connection => {
      const row = await selectForUpdate(connection, businessId);
      const currentRevision = Number(row?.draft_revision ?? 0);
      if (currentRevision !== expectedRevision) throw new WholesaleLayoutRevisionConflictError(currentRevision);
      const published = parseDocument(row?.published_json ?? null) ?? createDefaultWholesaleLayout();
      if (row) {
        await connection.execute(
          `UPDATE wholesale_portal_layouts
              SET schema_version = ?, draft_json = ?, draft_revision = draft_revision + 1,
                  draft_updated_by_user_id = ?, draft_updated_by_name = ?, draft_updated_at = CURRENT_TIMESTAMP(3)
            WHERE business_id = ?`,
          [WHOLESALE_LAYOUT_SCHEMA_VERSION, JSON.stringify(published), actor.userId, actor.name, businessId],
        );
      } else {
        await connection.execute(
          `INSERT INTO wholesale_portal_layouts
             (business_id, schema_version, draft_json, draft_revision,
              draft_updated_by_user_id, draft_updated_by_name, draft_updated_at)
           VALUES (?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP(3))`,
          [businessId, WHOLESALE_LAYOUT_SCHEMA_VERSION, JSON.stringify(published), actor.userId, actor.name],
        );
      }
      return mapEditorState(await selectForUpdate(connection, businessId));
    });
  },

  async publish(businessId: string, expectedDraftRevision: number, actor: WholesaleLayoutActor): Promise<WholesaleLayoutEditorState> {
    return inTransaction(async connection => {
      const row = await selectForUpdate(connection, businessId);
      const currentRevision = Number(row?.draft_revision ?? 0);
      if (!row || currentRevision !== expectedDraftRevision) throw new WholesaleLayoutRevisionConflictError(currentRevision);
      const draft = parseDocument(row.draft_json);
      if (!draft) throw new Error('Save a wholesale layout draft before publishing.');
      await connection.execute(
        `UPDATE wholesale_portal_layouts
            SET schema_version = ?, published_json = draft_json,
                published_revision = published_revision + 1,
                published_by_user_id = ?, published_by_name = ?, published_at = CURRENT_TIMESTAMP(3)
          WHERE business_id = ?`,
        [WHOLESALE_LAYOUT_SCHEMA_VERSION, actor.userId, actor.name, businessId],
      );
      return mapEditorState(await selectForUpdate(connection, businessId));
    });
  },
};