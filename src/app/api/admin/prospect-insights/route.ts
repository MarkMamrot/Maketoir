import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { query } from '@/services/MySQLService';
import { validateDateParameter } from '../prospect-leads/helpers';

function dateClause(column: string, from: string, to: string): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (from) { clauses.push(`${column} >= ?`); params.push(`${from} 00:00:00`); }
  if (to) { clauses.push(`${column} < DATE_ADD(?, INTERVAL 1 DAY)`); params.push(`${to} 00:00:00`); }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export async function GET(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';
  const fromError = from ? validateDateParameter(from, 'from') : null;
  const toError = to ? validateDateParameter(to, 'to') : null;
  if (fromError || toError) return NextResponse.json({ error: fromError || toError }, { status: 400 });

  const conversationDates = dateClause('created_at', from, to);
  const leadDates = dateClause('created_at', from, to);
  const eventDates = dateClause('event_at', from, to);
  const integrationDates = dateClause('sie.occurred_at', from, to);
  const insightDates = dateClause('last_seen_at', from, to);
  try {
    const [conversationFunnel, leadFunnel, topEventTypes, integrations, abandoned, highIntent, demandInsights, finalPromptClusters] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT status, COUNT(*) AS count FROM prospect_conversations ${conversationDates.sql} GROUP BY status`,
        conversationDates.params,
      ),
      query<Record<string, unknown>>(`SELECT status, COUNT(*) AS count FROM prospect_leads ${leadDates.sql} GROUP BY status`, leadDates.params),
      query<Record<string, unknown>>(
        `SELECT event_type, COUNT(*) AS count FROM (
           SELECT event_type, occurred_at AS event_at FROM prospect_events
           UNION ALL SELECT event_type, occurred_at FROM sales_integration_events
           UNION ALL SELECT event_type, created_at FROM prospect_lead_events
         ) all_events ${eventDates.sql}
         GROUP BY event_type ORDER BY count DESC, event_type LIMIT 20`,
        eventDates.params,
      ),
      query<Record<string, unknown>>(
        `SELECT COALESCE(NULLIF(sie.provider_name, ''), sio.name, 'Unspecified') AS provider,
                sio.id AS offering_id, sio.name AS offering_name, sio.category,
                COUNT(*) AS event_count, COUNT(DISTINCT sie.conversation_id) AS conversation_count,
                MAX(sie.occurred_at) AS last_seen_at
           FROM sales_integration_events sie
           LEFT JOIN sales_integration_offerings sio ON sio.id = sie.offering_id
           ${integrationDates.sql}
          GROUP BY provider, sio.id, sio.name, sio.category
          ORDER BY event_count DESC, provider LIMIT 50`,
        integrationDates.params,
      ),
      query<Record<string, unknown>>(
        `SELECT pc.id, pc.source_path, pc.last_user_prompt, pc.message_count, pc.last_message_at, pc.updated_at
           FROM prospect_conversations pc
           LEFT JOIN prospect_leads pl ON pl.conversation_id = pc.id
          WHERE pc.status = 'active' AND pl.id IS NULL AND pc.updated_at < UTC_TIMESTAMP(3) - INTERVAL 24 HOUR
            ${from ? 'AND pc.created_at >= ?' : ''} ${to ? 'AND pc.created_at < DATE_ADD(?, INTERVAL 1 DAY)' : ''}
          ORDER BY pc.updated_at DESC LIMIT 100`,
        conversationDates.params,
      ),
      query<Record<string, unknown>>(
        `SELECT pc.id, pc.status, pc.source_path, pc.last_user_prompt, pc.message_count, pc.last_message_at,
                MAX(pm.created_at) AS intent_seen_at
           FROM prospect_conversations pc
           JOIN prospect_messages pm ON pm.conversation_id = pc.id AND pm.role = 'assistant'
           LEFT JOIN prospect_leads pl ON pl.conversation_id = pc.id
          WHERE JSON_UNQUOTE(JSON_EXTRACT(pm.metadata_json, '$.intent')) = 'high_intent'
            AND pl.id IS NULL
            ${from ? 'AND pc.created_at >= ?' : ''} ${to ? 'AND pc.created_at < DATE_ADD(?, INTERVAL 1 DAY)' : ''}
          GROUP BY pc.id ORDER BY intent_seen_at DESC LIMIT 100`,
        conversationDates.params,
      ),
      query<Record<string, unknown>>(
        `SELECT demand_type, requested_name, requested_provider, sample_prompt, occurrence_count,
                conversation_count, first_seen_at, last_seen_at
           FROM prospect_demand_insights ${insightDates.sql}
          ORDER BY occurrence_count DESC, last_seen_at DESC LIMIT 100`,
        insightDates.params,
      ),
      query<Record<string, unknown>>(
        `SELECT JSON_UNQUOTE(JSON_EXTRACT(pm.metadata_json, '$.intent')) AS intent,
                COALESCE(
                  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(pm.metadata_json, '$.requestedIntegration')), 'null'),
                  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(pm.metadata_json, '$.requestedProvider')), 'null'),
                  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(pm.metadata_json, '$.unmetNeed')), 'null')
                ) AS cluster,
                COUNT(DISTINCT pm.conversation_id) AS conversation_count,
                SUBSTRING_INDEX(GROUP_CONCAT(pc.last_user_prompt ORDER BY pm.created_at DESC SEPARATOR '\n'), '\n', 1) AS sample_prompt,
                MAX(pm.created_at) AS last_seen_at
           FROM prospect_messages pm
           JOIN prospect_conversations pc ON pc.id = pm.conversation_id
          WHERE pm.role = 'assistant' AND JSON_VALID(pm.metadata_json)
            AND COALESCE(
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(pm.metadata_json, '$.requestedIntegration')), 'null'),
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(pm.metadata_json, '$.requestedProvider')), 'null'),
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(pm.metadata_json, '$.unmetNeed')), 'null')
            ) IS NOT NULL
            ${from ? 'AND pm.created_at >= ?' : ''} ${to ? 'AND pm.created_at < DATE_ADD(?, INTERVAL 1 DAY)' : ''}
          GROUP BY intent, cluster ORDER BY conversation_count DESC, last_seen_at DESC LIMIT 50`,
        conversationDates.params,
      ),
    ]);
    const totalConversations = conversationFunnel.reduce((total, row) => total + Number(row.count ?? 0), 0);
    const totalLeads = leadFunnel.reduce((total, row) => total + Number(row.count ?? 0), 0);
    return NextResponse.json({
      success: true,
      funnel: { totalConversations, totalLeads, conversionRate: totalConversations ? totalLeads / totalConversations : 0, conversations: conversationFunnel, leads: leadFunnel },
      topEventTypes, integrations, abandonedConversations: abandoned, highIntentConversations: highIntent,
      demandInsights, finalPromptClusters,
    });
  } catch (error) {
    await reportRuntimeIssue({
      source: 'admin', operation: 'load_prospect_insights', title: 'Prospect insights failed to load', error,
      context: { from, to },
    });
    return NextResponse.json({ error: 'Prospect insights could not be loaded.' }, { status: 500 });
  }
}