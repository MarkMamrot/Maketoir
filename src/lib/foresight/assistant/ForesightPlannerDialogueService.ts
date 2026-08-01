import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { loadForesightPrompt } from '../prompts/promptManifest';
import {
  ForesightPlanningRepository,
  PlanningThreadConflictError,
  type PlanningMessageRow,
} from '../repositories/ForesightPlanningRepository';
import { ForesightPlannerToolService } from './ForesightPlannerToolService';
import type { PlannerModelGateway } from './PlannerModelGateway';
import {
  FORESIGHT_PLANNER_TOOL_DECLARATIONS,
  FORESIGHT_PLANNER_TOOL_MANIFEST_VERSION,
  FORESIGHT_PLANNER_TOOL_NAMES,
  type ForesightPlannerToolResult,
} from './plannerToolRegistry';

const MAX_HISTORY_MESSAGES = 40;
const MAX_TOOL_CALLS = 4;
const MAX_MESSAGE_LENGTH = 8_000;

interface RequestedToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface PlannerDialogueTurnResult {
  humanMessageId: number;
  assistantMessageId: number;
  threadRevision: number;
  message: string;
  citationFactIds: string[];
  questions: string[];
  modelId: string;
  promptVersion: string;
}

function messageHistory(messages: PlanningMessageRow[]): Array<{ actor: string; content: string }> {
  return messages.slice(-MAX_HISTORY_MESSAGES).map((message) => ({
    actor: message.actor_type,
    content: message.content.slice(0, MAX_MESSAGE_LENGTH),
  }));
}

function requestedToolCalls(value: unknown): RequestedToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_TOOL_CALLS).flatMap((item) => {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name : '';
    if (!FORESIGHT_PLANNER_TOOL_NAMES.includes(name as any)) return [];
    const args = row.args != null && typeof row.args === 'object' && !Array.isArray(row.args)
      ? row.args as Record<string, unknown>
      : {};
    return [{ name, args }];
  });
}

function finalTurn(value: Record<string, unknown>, knownFactIds: Set<string>): {
  message: string;
  citationFactIds: string[];
  questions: string[];
} {
  const message = typeof value.message === 'string' ? value.message.trim() : '';
  if (!message) throw new Error('Planner model returned no message.');
  if (message.length > MAX_MESSAGE_LENGTH) throw new Error('Planner model message exceeds 8000 characters.');
  const rawCitations = Array.isArray(value.citationFactIds) ? value.citationFactIds : [];
  const citationFactIds = [...new Set(rawCitations.map(String))];
  const unknown = citationFactIds.filter((factId) => !knownFactIds.has(factId));
  if (unknown.length > 0) throw new Error(`Planner model cited unknown facts: ${unknown.join(', ')}`);
  const questions = Array.isArray(value.questions)
    ? value.questions.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      .slice(0, 5).map((item) => item.trim().slice(0, 1_000))
    : [];
  return { message, citationFactIds, questions };
}

export const ForesightPlannerDialogueService = {
  async runTurn(input: {
    businessId: string;
    threadId: number;
    expectedRevision: number;
    actorUserId: number;
    content: string;
    modelId: string;
    model: PlannerModelGateway;
    enabledTools?: readonly string[];
  }): Promise<PlannerDialogueTurnResult> {
    const content = input.content.trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH) {
      throw new Error('content must be between 1 and 8000 characters');
    }
    const enabledTools = (input.enabledTools ?? FORESIGHT_PLANNER_TOOL_NAMES)
      .filter((name) => FORESIGHT_PLANNER_TOOL_NAMES.includes(name as any));
    const accepted = await ForesightPlanningRepository.appendHumanMessage(
      input.businessId,
      input.threadId,
      input.expectedRevision,
      { actorUserId: input.actorUserId, content },
    );
    try {
      const [prompt, messages] = await Promise.all([
        loadForesightPrompt('planner-dialogue'),
        ForesightPlanningRepository.listMessages(input.businessId, input.threadId, MAX_HISTORY_MESSAGES),
      ]);
      const declarations = FORESIGHT_PLANNER_TOOL_DECLARATIONS.filter((tool) => enabledTools.includes(tool.name));
      const currentDate = new Date().toISOString().slice(0, 10);
      const plan = await input.model.generateJson({
        modelId: input.modelId,
        systemInstruction: prompt.content,
        prompt: JSON.stringify({
          task: 'Select zero to four read tools needed for the next response.',
          currentDate,
          availableTools: declarations,
          conversation: messageHistory(messages),
        }),
      });
      const toolResults: ForesightPlannerToolResult[] = [];
      for (const call of requestedToolCalls(plan.toolCalls)) {
        toolResults.push(await ForesightPlannerToolService.execute({
          businessId: input.businessId,
          threadId: input.threadId,
          messageId: accepted.messageId,
          enabledTools,
          name: call.name,
          args: call.args,
        }));
      }
      const knownFactIds = new Set(toolResults.flatMap((result) => result.facts.map((fact) => fact.factId)));
      const response = await input.model.generateJson({
        modelId: input.modelId,
        systemInstruction: prompt.content,
        prompt: JSON.stringify({
          task: 'Respond to the latest human message using only supplied facts. Return message, citationFactIds, and questions.',
          currentDate,
          conversation: messageHistory(messages),
          toolResults,
        }),
      });
      const turn = finalTurn(response, knownFactIds);
      const saved = await ForesightPlanningRepository.appendAssistantMessage(
        input.businessId,
        input.threadId,
        accepted.threadRevision,
        {
          content: turn.message,
          modelId: input.modelId,
          promptVersion: prompt.version,
          message: {
            citationFactIds: turn.citationFactIds,
            questions: turn.questions,
            promptSha256: prompt.sha256,
            toolManifestVersion: FORESIGHT_PLANNER_TOOL_MANIFEST_VERSION,
          },
        },
      );
      return {
        humanMessageId: accepted.messageId,
        assistantMessageId: saved.messageId,
        threadRevision: saved.threadRevision,
        ...turn,
        modelId: input.modelId,
        promptVersion: prompt.version,
      };
    } catch (error) {
      if (error instanceof PlanningThreadConflictError) throw error;
      await reportRuntimeIssue({
        businessId: input.businessId,
        source: 'ForesightPlanner',
        operation: 'run_dialogue_turn',
        severity: 'error',
        title: 'Foresight planner dialogue turn failed',
        error,
        reference: { type: 'planning_thread', id: input.threadId },
        context: { modelId: input.modelId, humanMessageId: accepted.messageId },
      }).catch(() => undefined);
      throw error;
    }
  },
};