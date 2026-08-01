import { describe, expect, it } from 'vitest';
import {
  messageCitations,
  messageQuestions,
  plannerResponseJson,
  planningThreadTypeLabel,
  type PlanningMessage,
} from '../plannerWorkspaceModel';

const message: PlanningMessage = {
  id: 1, actor_type: 'assistant', content: 'Response', model_id: 'model', created_at: '2026-08-01',
  message_json: {
    citationFactIds: ['fact-1', 'fact-1', '', 'fact-2'],
    questions: ['Which audience?', '', 'What budget?'],
  },
};

describe('plannerWorkspaceModel', () => {
  it('normalizes citations and questions from durable message metadata', () => {
    expect(messageCitations(message)).toEqual(['fact-1', 'fact-2']);
    expect(messageQuestions(message)).toEqual(['Which audience?', 'What budget?']);
  });

  it('parses JSON and preserves useful non-JSON errors', async () => {
    await expect(plannerResponseJson(new Response('{"success":true}'))).resolves.toEqual({ success: true });
    await expect(plannerResponseJson(new Response('Gateway unavailable'))).resolves.toEqual({ error: 'Gateway unavailable' });
  });

  it('provides concise thread type labels', () => {
    expect(planningThreadTypeLabel('strategy')).toBe('Strategy');
    expect(planningThreadTypeLabel('recommendation')).toBe('Recommendation');
    expect(planningThreadTypeLabel('initiative')).toBe('Initiative');
  });
});