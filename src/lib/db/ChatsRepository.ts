import { query, execute } from '@/services/MySQLService';

export interface ChatEntry {
  id?:         number;
  business_id: string;
  role:        'user' | 'assistant' | 'system';
  content:     string;
  context_json: Record<string, any> | null;
  created_at?: string;
}

export const ChatsRepository = {
  async recent(businessId: string, n = 50): Promise<ChatEntry[]> {
    const limit = Math.min(Math.max(1, Math.floor(n)), 500);
    const rows = await query<ChatEntry>(
      `SELECT * FROM (
         SELECT * FROM chats WHERE business_id = ?
         ORDER BY created_at DESC LIMIT ?
       ) t ORDER BY created_at ASC`,
      [businessId, limit],
    );
    return rows.map(r => ({
      ...r,
      context_json: typeof r.context_json === 'string'
        ? (() => { try { return JSON.parse(r.context_json as any); } catch { return null; } })()
        : r.context_json,
    }));
  },

  async append(businessId: string, entry: Omit<ChatEntry, 'id' | 'business_id' | 'created_at'>): Promise<number> {
    const result = await execute(
      `INSERT INTO chats (business_id, role, content, context_json)
       VALUES (?, ?, ?, ?)`,
      [businessId, entry.role, entry.content,
       entry.context_json ? JSON.stringify(entry.context_json) : null],
    );
    return result.insertId;
  },

  async clearOlderThan(businessId: string, days: number): Promise<void> {
    await execute(
      'DELETE FROM chats WHERE business_id = ? AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
      [businessId, days],
    );
  },
};
