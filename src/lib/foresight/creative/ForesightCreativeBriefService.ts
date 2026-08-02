import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import type { PlannerModelGateway } from '../assistant/PlannerModelGateway';
import { loadForesightPrompt } from '../prompts/promptManifest';
import { ForesightRepository } from '../repositories/ForesightRepository';
import { ForesightCreativeRepository } from '../repositories/ForesightCreativeRepository';
import {
  CreativeBriefTransitionError,
  ForesightCreativeBriefRepository,
  type CreativeBriefVersionRow,
} from '../repositories/ForesightCreativeBriefRepository';
import { CreativeBriefValidationError } from './creativeBrief';
import { diagnoseCreativePerformance } from './creativeDiagnostics';

interface Dependencies {
  getCreative: typeof ForesightCreativeRepository.get;
  getThread: typeof ForesightCreativeBriefRepository.getThread;
  getHumanContext: typeof ForesightCreativeBriefRepository.latestHumanContext;
  getAssessment: typeof ForesightCreativeRepository.latestAssessment;
  listDiagnosticInputs: typeof ForesightCreativeRepository.listDiagnosticInputs;
  getStrategy: typeof ForesightRepository.latestStrategy;
  getLatestBrief: typeof ForesightCreativeBriefRepository.latest;
  loadPrompt: typeof loadForesightPrompt;
  createVersion: typeof ForesightCreativeBriefRepository.createVersion;
  reportIssue: typeof reportRuntimeIssue;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const defaults: Dependencies = {
  getCreative: ForesightCreativeRepository.get,
  getThread: ForesightCreativeBriefRepository.getThread,
  getHumanContext: ForesightCreativeBriefRepository.latestHumanContext,
  getAssessment: ForesightCreativeRepository.latestAssessment,
  listDiagnosticInputs: ForesightCreativeRepository.listDiagnosticInputs,
  getStrategy: ForesightRepository.latestStrategy,
  getLatestBrief: ForesightCreativeBriefRepository.latest,
  loadPrompt: loadForesightPrompt,
  createVersion: ForesightCreativeBriefRepository.createVersion,
  reportIssue: reportRuntimeIssue,
};

export function createForesightCreativeBriefService(dependencies: Dependencies = defaults) {
  return {
    async generate(input: {
      businessId: string; creativeId: number; threadId: number; expectedRevision: number;
      diagnosticsThrough: string; actorUserId: number; modelId: string; model: PlannerModelGateway;
      changeReason?: string | null;
    }): Promise<CreativeBriefVersionRow> {
      try {
        const startDate = addDays(input.diagnosticsThrough, -13);
        const [creative, thread, humanContext, assessment, diagnosticInputs, strategy, latestBrief, prompt] = await Promise.all([
          dependencies.getCreative(input.businessId, input.creativeId),
          dependencies.getThread(input.businessId, input.creativeId),
          dependencies.getHumanContext(input.businessId, input.threadId),
          dependencies.getAssessment(input.businessId, input.creativeId),
          dependencies.listDiagnosticInputs(input.businessId, startDate, input.diagnosticsThrough, 100),
          dependencies.getStrategy(input.businessId),
          dependencies.getLatestBrief(input.businessId, input.creativeId),
          dependencies.loadPrompt('creative-brief'),
        ]);
        if (!creative) throw new CreativeBriefTransitionError('Creative not found.');
        if (!thread || thread.id !== input.threadId) throw new CreativeBriefTransitionError('Creative Review thread not found.');
        if (!humanContext) throw new CreativeBriefTransitionError('Answer the Creative Review context questions before drafting a brief.');
        if (!assessment) throw new CreativeBriefTransitionError('A governed creative assessment is required before drafting a brief.');
        const diagnostics = diagnoseCreativePerformance({ throughDate: input.diagnosticsThrough, creatives: diagnosticInputs });
        const reviewedDiagnostic = diagnostics.creatives.find((item) => item.creativeId === input.creativeId) ?? null;
        const raw = await input.model.generateJson({
          modelId: input.modelId,
          systemInstruction: prompt.content,
          prompt: JSON.stringify({
            task: 'Draft a complete non-publishable creative brief for the reviewed creative.',
            creative,
            assessment: { id: assessment.id, evidenceMode: assessment.evidence_mode, document: assessment.assessment_json },
            diagnostics: { ...diagnostics, creatives: reviewedDiagnostic ? [reviewedDiagnostic] : [] },
            currentStrategy: strategy ? { id: strategy.id, version: strategy.version, strategy: strategy.strategy_json } : null,
            humanContext,
            previousBrief: latestBrief?.document_json ?? null,
            requiredIdentity: { schemaVersion: 1, creativeId: creative.id, assessmentId: assessment.id,
              diagnosticsThrough: input.diagnosticsThrough, humanContext, publishable: false },
          }),
        });
        return dependencies.createVersion(input.businessId, input.threadId, input.expectedRevision, {
          creativeId: creative.id, assessmentId: assessment.id, diagnosticsThrough: input.diagnosticsThrough,
          humanContext, document: raw, modelId: input.modelId, promptVersion: prompt.version,
          promptHash: prompt.sha256, authoredBy: input.actorUserId,
          changeReason: input.changeReason?.trim() || (latestBrief ? 'AI-assisted creative brief revision' : 'Initial AI-assisted creative brief'),
        });
      } catch (error) {
        if (error instanceof CreativeBriefTransitionError || error instanceof CreativeBriefValidationError) throw error;
        await dependencies.reportIssue({ businessId: input.businessId, source: 'ForesightCreativeBriefService',
          operation: 'draft_creative_brief', severity: 'error', title: 'Foresight creative brief drafting failed', error,
          reference: { type: 'foresight_creative', id: input.creativeId },
          context: { threadId: input.threadId, modelId: input.modelId, diagnosticsThrough: input.diagnosticsThrough } }).catch(() => undefined);
        throw error;
      }
    },
  };
}

export const ForesightCreativeBriefService = createForesightCreativeBriefService();
