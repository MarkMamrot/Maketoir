export type PlanningThreadType = 'strategy' | 'recommendation' | 'initiative';
export type PlanningActorType = 'human' | 'assistant' | 'system' | 'algorithm';

export interface PlanningThread {
  id: number;
  thread_type: PlanningThreadType;
  state: string;
  title: string;
  revision: number;
  updated_at: string;
}

export interface PlanningMessage {
  id: number;
  actor_type: PlanningActorType;
  content: string;
  model_id: string | null;
  message_json: {
    citationFactIds?: string[];
    questions?: string[];
  } | null;
  created_at: string;
}

export interface PlanningThreadDetail {
  thread: PlanningThread;
  messages: PlanningMessage[];
  latestPlan: {
    id: number;
    plan_hash: string;
    markdown_text?: string;
    version?: number;
    state?: string;
  } | null;
  latestValidation: {
    state: 'passed' | 'failed' | 'needs_human';
    findings_json: { blocking?: string[]; needsHuman?: string[]; warnings?: string[] };
    validator_version: string;
  } | null;
  latestReview: {
    id: number;
    plan_version_id: number;
    plan_hash: string;
    action: 'submitted' | 'accepted' | 'rejected' | 'revision_requested';
    note: string | null;
    created_at: string;
  } | null;
  links: Array<{
    id: number;
    link_type: 'recommendation' | 'initiative' | 'strategy' | 'creative';
    link_id: string;
  }>;
}

export async function plannerResponseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    const parsed = text ? JSON.parse(text) : {};
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return { error: text || 'Unexpected server response.' };
  }
}

export function messageCitations(message: PlanningMessage): string[] {
  const values = message.message_json?.citationFactIds;
  return Array.isArray(values) ? [...new Set(values.filter((item) => typeof item === 'string' && item.trim()))] : [];
}

export function messageQuestions(message: PlanningMessage | undefined): string[] {
  const values = message?.message_json?.questions;
  return Array.isArray(values)
    ? values.filter((item) => typeof item === 'string' && item.trim()).slice(0, 5)
    : [];
}

export function planningThreadTypeLabel(type: PlanningThreadType): string {
  if (type === 'strategy') return 'Strategy';
  if (type === 'recommendation') return 'Recommendation';
  return 'Initiative';
}