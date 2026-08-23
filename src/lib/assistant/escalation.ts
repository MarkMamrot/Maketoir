import { createHash } from 'node:crypto';

import { deliverPendingRuntimeIssueAlert } from '@/lib/runtimeIssueAlerts';
import { reportRuntimeIssue, type ReportRuntimeIssueInput } from '@/lib/runtimeIssues';

import { deliverPendingWorkflowFindingAlert } from './findingAlerts';
import {
  createAssistantEscalation,
  reportWorkflowFinding,
  type CreateAssistantEscalationInput,
  type ReportWorkflowFindingInput,
} from './findings';
import { buildEscalationMessage } from './policy';

export interface AssistantEscalationDependencies {
  reportRuntimeIssue(input: ReportRuntimeIssueInput): Promise<number | null>;
  reportWorkflowFinding(input: ReportWorkflowFindingInput): Promise<number>;
  createEscalation(input: CreateAssistantEscalationInput): Promise<{ publicReference: string }>;
  deliverRuntimeAlert(issueId: number): Promise<boolean>;
  deliverFindingAlert(findingId: number): Promise<boolean>;
}

const defaultDependencies: AssistantEscalationDependencies = {
  reportRuntimeIssue,
  reportWorkflowFinding,
  createEscalation: createAssistantEscalation,
  deliverRuntimeAlert: deliverPendingRuntimeIssueAlert,
  deliverFindingAlert: deliverPendingWorkflowFindingAlert,
};

export type BlockedAssistantEscalationInput = Omit<CreateAssistantEscalationInput, 'parentKind' | 'parentId' | 'idempotencyKey'> & (
  | { kind: 'technical_blocker'; runtimeIssue: ReportRuntimeIssueInput }
  | { kind: 'workflow_blocker'; workflowFinding: ReportWorkflowFindingInput }
);

function idempotencyKey(input: BlockedAssistantEscalationInput, parentId: number): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash('sha256').update([
    input.kind, parentId, input.businessId, input.actorType, input.actorId,
    input.sourceReference?.type ?? '', input.sourceReference?.id ?? '', day,
  ].join('|')).digest('hex');
}

export async function escalateBlockedAssistantRequest(
  input: BlockedAssistantEscalationInput,
  dependencies: AssistantEscalationDependencies = defaultDependencies,
): Promise<{ escalated: true; publicReference: string; message: string } | { escalated: false; message: string }> {
  let parentId: number | null = null;
  try {
    if (input.kind === 'technical_blocker') {
      parentId = await dependencies.reportRuntimeIssue({
        ...input.runtimeIssue,
        businessId: input.businessId,
        notifyDevelopers: true,
        deferAlert: true,
      });
      if (!parentId) throw new Error('Technical issue could not be persisted.');
    } else {
      parentId = await dependencies.reportWorkflowFinding({
        ...input.workflowFinding,
        businessId: input.businessId,
      });
    }

    const escalation = await dependencies.createEscalation({
      parentKind: input.kind === 'technical_blocker' ? 'runtime_issue' : 'workflow_finding',
      parentId,
      businessId: input.businessId,
      audience: input.audience,
      actorType: input.actorType,
      actorId: input.actorId,
      canFollowUpDirectly: input.canFollowUpDirectly,
      sourceReference: input.sourceReference,
      currentView: input.currentView,
      idempotencyKey: idempotencyKey(input, parentId),
    });

    if (input.kind === 'technical_blocker') {
      await dependencies.deliverRuntimeAlert(parentId).catch(() => false);
    } else {
      await dependencies.deliverFindingAlert(parentId).catch(() => false);
    }
    return {
      escalated: true,
      publicReference: escalation.publicReference,
      message: buildEscalationMessage(input.kind, escalation.publicReference, input.canFollowUpDirectly),
    };
  } catch (error) {
    if (parentId) {
      if (input.kind === 'technical_blocker') await dependencies.deliverRuntimeAlert(parentId).catch(() => false);
      else await dependencies.deliverFindingAlert(parentId).catch(() => false);
    }
    console.error('[assistant-escalation] failed to create durable user case:', error);
    return {
      escalated: false,
      message: 'I could not complete that request just now. Please try again, or contact support if it remains unavailable.',
    };
  }
}