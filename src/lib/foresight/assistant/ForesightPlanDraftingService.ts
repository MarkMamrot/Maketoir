import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import {
  ForesightPlanValidationError,
  parseForesightPlanDocument,
  type ForesightPlanDocument,
} from '../planning/planDocument';
import {
  FORESIGHT_PLAN_VALIDATOR_VERSION,
  validatePlanDraft,
  type PlanDraftValidation,
} from '../planning/validatePlanDraft';
import { loadForesightPrompt } from '../prompts/promptManifest';
import {
  ForesightPlanningRepository,
  PlanningThreadConflictError,
  type PlanningMessageRow,
} from '../repositories/ForesightPlanningRepository';
import { FORESIGHT_PLANNER_TOOL_MANIFEST_VERSION } from './plannerToolRegistry';
import type { PlannerModelGateway } from './PlannerModelGateway';

const MAX_HISTORY_MESSAGES = 40;
const MAX_MESSAGE_LENGTH = 8_000;

export class PlanDraftRejectedError extends Error {
  constructor(public readonly validation: PlanDraftValidation) {
    super('The drafted plan failed deterministic validation.');
    this.name = 'PlanDraftRejectedError';
  }
}

export interface PlanDraftingResult {
  planVersionId: number;
  version: number;
  planHash: string;
  markdown: string;
  threadRevision: number;
  validationId: number;
  validation: PlanDraftValidation;
  plan: ForesightPlanDocument;
  modelId: string;
  promptVersion: string;
}

function history(messages: PlanningMessageRow[]) {
  return messages.slice(-MAX_HISTORY_MESSAGES).map((message) => ({
    actor: message.actor_type,
    content: message.content.slice(0, MAX_MESSAGE_LENGTH),
  }));
}

export const ForesightPlanDraftingService = {
  async draft(input: {
    businessId: string;
    threadId: number;
    expectedRevision: number;
    actorUserId: number;
    modelId: string;
    model: PlannerModelGateway;
    changeReason?: string | null;
  }): Promise<PlanDraftingResult> {
    try {
      const [thread, prompt, messages, links, facts, latestPlan] = await Promise.all([
        ForesightPlanningRepository.getThread(input.businessId, input.threadId),
        loadForesightPrompt('initiative-planner'),
        ForesightPlanningRepository.listMessages(input.businessId, input.threadId, MAX_HISTORY_MESSAGES),
        ForesightPlanningRepository.listThreadLinks(input.businessId, input.threadId),
        ForesightPlanningRepository.listThreadFacts(input.businessId, input.threadId),
        ForesightPlanningRepository.latestPlanVersion(input.businessId, input.threadId),
      ]);
      if (!thread) throw new Error('Planning thread not found.');
      if (thread.revision !== input.expectedRevision) throw new PlanningThreadConflictError();

      const rawPlan = await input.model.generateJson({
        modelId: input.modelId,
        systemInstruction: prompt.content,
        prompt: JSON.stringify({
          task: 'Draft the next complete Foresight plan document using only the supplied audited facts and human context.',
          currentDate: new Date().toISOString().slice(0, 10),
          thread: { id: thread.id, type: thread.thread_type, title: thread.title },
          conversation: history(messages),
          links: links.map((link) => ({ type: link.link_type, id: link.link_id })),
          auditedFacts: facts,
          previousPlan: latestPlan?.plan_json ?? null,
        }),
      });
      const plan = parseForesightPlanDocument(rawPlan);
      const validation = validatePlanDraft(plan, facts, links);
      if (validation.state === 'failed') throw new PlanDraftRejectedError(validation);

      const saved = await ForesightPlanningRepository.createPlanVersion(
        input.businessId,
        input.threadId,
        input.expectedRevision,
        {
          plan,
          state: validation.state === 'passed' ? 'ready_for_validation' : 'drafting',
          authoredBy: input.actorUserId,
          modelId: input.modelId,
          promptVersion: prompt.version,
          toolManifestVersion: FORESIGHT_PLANNER_TOOL_MANIFEST_VERSION,
          changeReason: input.changeReason?.trim() || (latestPlan ? 'AI-assisted plan revision' : 'Initial AI-assisted plan draft'),
        },
      );
      const validationId = await ForesightPlanningRepository.recordValidation(input.businessId, {
        threadId: input.threadId,
        planVersionId: saved.id,
        planHash: saved.planHash,
        state: validation.state,
        findings: validation.findings,
        validatorVersion: FORESIGHT_PLAN_VALIDATOR_VERSION,
        validatedBy: input.actorUserId,
      });
      return {
        planVersionId: saved.id,
        version: saved.version,
        planHash: saved.planHash,
        markdown: saved.markdown,
        threadRevision: saved.threadRevision,
        validationId,
        validation,
        plan,
        modelId: input.modelId,
        promptVersion: prompt.version,
      };
    } catch (error) {
      if (error instanceof PlanningThreadConflictError
        || error instanceof PlanDraftRejectedError
        || error instanceof ForesightPlanValidationError) throw error;
      await reportRuntimeIssue({
        businessId: input.businessId,
        source: 'ForesightPlanner',
        operation: 'draft_structured_plan',
        severity: 'error',
        title: 'Foresight structured plan drafting failed',
        error,
        reference: { type: 'planning_thread', id: input.threadId },
        context: { modelId: input.modelId, expectedRevision: input.expectedRevision },
      }).catch(() => undefined);
      throw error;
    }
  },
};