import { randomUUID } from 'crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import { execute, getPool, query } from '@/services/MySQLService';
import { createDefaultOnlineShopContentPage, normalizeOnlineShopContentPage } from './layout/validation';
import { ONLINE_SHOP_CONTENT_PAGE_SCHEMA_VERSION, type OnlineShopContentPageDocument } from './layout/types';

export type OnlineShopPageNavigation = 'none' | 'header' | 'footer' | 'both';
export interface OnlineShopPageActor { userId: number; name: string }
export interface OnlineShopPageSummary {
  pageId: string; slug: string; title: string; navigationLocation: OnlineShopPageNavigation;
  navigationLabel: string | null; sortOrder: number; isVisible: boolean;
  draftRevision: number; publishedRevision: number; publishedAt: string | null;
}
export interface OnlineShopPageEditorState extends OnlineShopPageSummary {
  metaTitle: string | null; metaDescription: string | null;
  draft: OnlineShopContentPageDocument; published: OnlineShopContentPageDocument | null;
}
export interface OnlineShopPublishedPage {
  pageId: string; slug: string; title: string; metaTitle: string | null; metaDescription: string | null;
  navigationLocation: OnlineShopPageNavigation; navigationLabel: string | null; sortOrder: number;
  document: OnlineShopContentPageDocument; publishedAt: string | null;
}

interface PageRow extends RowDataPacket {
  page_id: string; slug: string; title: string; meta_title: string | null; meta_description: string | null;
  navigation_location: OnlineShopPageNavigation; navigation_label: string | null; sort_order: number; is_visible: number;
  draft_json: string | OnlineShopContentPageDocument | null; published_json: string | OnlineShopContentPageDocument | null;
  draft_revision: number; published_revision: number; published_at: Date | string | null;
}

export class OnlineShopPageRevisionConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super('The online shop page draft was changed by another editor.');
    this.name = 'OnlineShopPageRevisionConflictError';
  }
}

export function normalizeOnlineShopPageSlug(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 100).replace(/-+$/g, '');
}

function requiredText(value: unknown, label: string, max: number): string {
  const text = typeof value === 'string' ? value.trim().slice(0, max) : '';
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function optionalText(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.trim().slice(0, max) || null : null;
}

function parseDocument(value: PageRow['draft_json']): OnlineShopContentPageDocument | null {
  if (!value) return null;
  try { return normalizeOnlineShopContentPage(typeof value === 'string' ? JSON.parse(value) : value); } catch { return null; }
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapState(row: PageRow): OnlineShopPageEditorState {
  return {
    pageId: row.page_id, slug: row.slug, title: row.title, metaTitle: row.meta_title,
    metaDescription: row.meta_description, navigationLocation: row.navigation_location,
    navigationLabel: row.navigation_label, sortOrder: Number(row.sort_order), isVisible: row.is_visible === 1,
    draftRevision: Number(row.draft_revision), publishedRevision: Number(row.published_revision), publishedAt: iso(row.published_at),
    draft: parseDocument(row.draft_json) ?? parseDocument(row.published_json) ?? createDefaultOnlineShopContentPage(),
    published: parseDocument(row.published_json),
  };
}

function mapPublished(row: PageRow): OnlineShopPublishedPage | null {
  const document = parseDocument(row.published_json);
  if (!document) return null;
  return { pageId: row.page_id, slug: row.slug, title: row.title, metaTitle: row.meta_title,
    metaDescription: row.meta_description, navigationLocation: row.navigation_location,
    navigationLabel: row.navigation_label, sortOrder: Number(row.sort_order), document, publishedAt: iso(row.published_at) };
}

const select = `SELECT page_id, slug, title, meta_title, meta_description, navigation_location, navigation_label,
  sort_order, is_visible, draft_json, published_json, draft_revision, published_revision, published_at FROM online_shop_pages`;

async function selectForUpdate(connection: PoolConnection, businessId: string, pageId: string): Promise<PageRow | undefined> {
  const [rows] = await connection.execute<PageRow[]>(`${select} WHERE business_id = ? AND page_id = ? FOR UPDATE`, [businessId, pageId]);
  return rows[0];
}

async function transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getPool().getConnection();
  try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result; }
  catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export const OnlineShopPageRepository = {
  async list(businessId: string): Promise<OnlineShopPageSummary[]> {
    const rows = await query<PageRow>(`${select} WHERE business_id = ? ORDER BY sort_order, title, page_id`, [businessId]);
    return rows.map(row => { const { draft: _draft, published: _published, metaTitle: _metaTitle, metaDescription: _metaDescription, ...summary } = mapState(row); return summary; });
  },

  async getEditorState(businessId: string, pageId: string): Promise<OnlineShopPageEditorState | null> {
    const rows = await query<PageRow>(`${select} WHERE business_id = ? AND page_id = ? LIMIT 1`, [businessId, pageId]);
    return rows[0] ? mapState(rows[0]) : null;
  },

  async getPublishedBySlug(businessId: string, slugInput: unknown): Promise<OnlineShopPublishedPage | null> {
    const slug = normalizeOnlineShopPageSlug(slugInput);
    if (!slug) return null;
    const rows = await query<PageRow>(`${select} WHERE business_id = ? AND slug = ? AND is_visible = 1 AND published_json IS NOT NULL LIMIT 1`, [businessId, slug]);
    return rows[0] ? mapPublished(rows[0]) : null;
  },

  async listPublishedNavigation(businessId: string): Promise<OnlineShopPublishedPage[]> {
    const rows = await query<PageRow>(`${select} WHERE business_id = ? AND is_visible = 1 AND published_json IS NOT NULL
      AND navigation_location <> 'none' ORDER BY sort_order, title, page_id`, [businessId]);
    return rows.map(mapPublished).filter((page): page is OnlineShopPublishedPage => Boolean(page));
  },

  async create(businessId: string, input: { slug: unknown; title: unknown }, actor: OnlineShopPageActor): Promise<OnlineShopPageEditorState> {
    const slug = normalizeOnlineShopPageSlug(input.slug);
    if (slug.length < 2) throw new Error('Page slug must contain at least 2 characters.');
    const title = requiredText(input.title, 'Page title', 255);
    const pageId = randomUUID();
    const document = createDefaultOnlineShopContentPage();
    await query(
      `INSERT INTO online_shop_pages (page_id, business_id, slug, title, schema_version, draft_json, draft_revision,
        draft_updated_by_user_id, draft_updated_by_name, draft_updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP(3))`,
      [pageId, businessId, slug, title, ONLINE_SHOP_CONTENT_PAGE_SCHEMA_VERSION, JSON.stringify(document), actor.userId, actor.name],
    );
    return (await this.getEditorState(businessId, pageId))!;
  },

  async saveDraft(businessId: string, pageId: string, input: {
    document: OnlineShopContentPageDocument; expectedRevision: number; slug: unknown; title: unknown;
    metaTitle?: unknown; metaDescription?: unknown; navigationLocation?: unknown; navigationLabel?: unknown;
    sortOrder?: unknown; isVisible?: unknown;
  }, actor: OnlineShopPageActor): Promise<OnlineShopPageEditorState> {
    const normalized = normalizeOnlineShopContentPage(input.document);
    const slug = normalizeOnlineShopPageSlug(input.slug);
    if (slug.length < 2) throw new Error('Page slug must contain at least 2 characters.');
    const title = requiredText(input.title, 'Page title', 255);
    const navigation = ['none', 'header', 'footer', 'both'].includes(String(input.navigationLocation)) ? input.navigationLocation as OnlineShopPageNavigation : 'none';
    return transaction(async connection => {
      const row = await selectForUpdate(connection, businessId, pageId);
      if (!row) throw new Error('Online shop page not found.');
      if (Number(row.draft_revision) !== input.expectedRevision) throw new OnlineShopPageRevisionConflictError(Number(row.draft_revision));
      await connection.execute(
        `UPDATE online_shop_pages SET slug = ?, title = ?, meta_title = ?, meta_description = ?, navigation_location = ?,
          navigation_label = ?, sort_order = ?, is_visible = ?, schema_version = ?, draft_json = ?, draft_revision = draft_revision + 1,
          draft_updated_by_user_id = ?, draft_updated_by_name = ?, draft_updated_at = CURRENT_TIMESTAMP(3)
          WHERE business_id = ? AND page_id = ?`,
        [slug, title, optionalText(input.metaTitle, 255), optionalText(input.metaDescription, 500), navigation,
          optionalText(input.navigationLabel, 100), Number.isSafeInteger(input.sortOrder) ? input.sortOrder : 0,
          input.isVisible === true ? 1 : 0, ONLINE_SHOP_CONTENT_PAGE_SCHEMA_VERSION, JSON.stringify(normalized),
          actor.userId, actor.name, businessId, pageId]);
      return mapState((await selectForUpdate(connection, businessId, pageId))!);
    });
  },

  async resetDraft(businessId: string, pageId: string, expectedRevision: number, actor: OnlineShopPageActor): Promise<OnlineShopPageEditorState> {
    return transaction(async connection => {
      const row = await selectForUpdate(connection, businessId, pageId);
      if (!row) throw new Error('Online shop page not found.');
      if (Number(row.draft_revision) !== expectedRevision) throw new OnlineShopPageRevisionConflictError(Number(row.draft_revision));
      const published = parseDocument(row.published_json) ?? createDefaultOnlineShopContentPage();
      await connection.execute(
        `UPDATE online_shop_pages SET schema_version = ?, draft_json = ?, draft_revision = draft_revision + 1,
          draft_updated_by_user_id = ?, draft_updated_by_name = ?, draft_updated_at = CURRENT_TIMESTAMP(3)
          WHERE business_id = ? AND page_id = ?`,
        [ONLINE_SHOP_CONTENT_PAGE_SCHEMA_VERSION, JSON.stringify(published), actor.userId, actor.name, businessId, pageId]);
      return mapState((await selectForUpdate(connection, businessId, pageId))!);
    });
  },

  async publish(businessId: string, pageId: string, expectedRevision: number, actor: OnlineShopPageActor): Promise<OnlineShopPageEditorState> {
    return transaction(async connection => {
      const row = await selectForUpdate(connection, businessId, pageId);
      if (!row) throw new Error('Online shop page not found.');
      if (Number(row.draft_revision) !== expectedRevision) throw new OnlineShopPageRevisionConflictError(Number(row.draft_revision));
      if (!parseDocument(row.draft_json)) throw new Error('Save the page draft before publishing.');
      await connection.execute(
        `UPDATE online_shop_pages SET published_json = draft_json, published_revision = published_revision + 1,
          published_by_user_id = ?, published_by_name = ?, published_at = CURRENT_TIMESTAMP(3)
          WHERE business_id = ? AND page_id = ?`, [actor.userId, actor.name, businessId, pageId]);
      return mapState((await selectForUpdate(connection, businessId, pageId))!);
    });
  },

  async delete(businessId: string, pageId: string): Promise<boolean> {
    const result = await execute(
      'DELETE FROM online_shop_pages WHERE business_id = ? AND page_id = ?', [businessId, pageId]);
    return result.affectedRows > 0;
  },
};