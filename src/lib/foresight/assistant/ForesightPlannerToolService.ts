import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { ForesightPlanningRepository } from '../repositories/ForesightPlanningRepository';
import {
  executeForesightPlannerTool,
  type ForesightPlannerToolResult,
} from './plannerToolRegistry';

export const ForesightPlannerToolService = {
  async execute(input: {
    businessId: string;
    threadId: number;
    messageId?: number | null;
    enabledTools: readonly string[];
    name: string;
    args?: Record<string, unknown>;
  }): Promise<ForesightPlannerToolResult> {
    const startedAt = Date.now();
    const toolCallId = await ForesightPlanningRepository.startToolCall(
      input.businessId,
      input.threadId,
      {
        toolName: input.name,
        arguments: input.args ?? {},
        messageId: input.messageId ?? null,
      },
    );
    try {
      const result = await executeForesightPlannerTool({
        businessId: input.businessId,
        enabledTools: input.enabledTools,
        name: input.name,
        args: input.args,
      });
      await ForesightPlanningRepository.completeToolCall(input.businessId, toolCallId, {
        state: 'succeeded',
        result: result as unknown as Record<string, unknown>,
        factIds: result.facts.map((fact) => fact.factId),
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      await ForesightPlanningRepository.completeToolCall(input.businessId, toolCallId, {
        state: 'failed',
        factIds: [],
        errorText: error instanceof Error ? error.message : 'Planner tool failed.',
        durationMs: Date.now() - startedAt,
      }).catch(() => undefined);
      if (!isExpectedValidationError(error)) {
        await reportRuntimeIssue({
          businessId: input.businessId,
          source: 'ForesightPlanner',
          operation: 'execute_read_tool',
          severity: 'error',
          title: 'Foresight planner data tool failed',
          error,
          reference: { type: 'planning_thread', id: input.threadId },
          context: { toolName: input.name, toolCallId },
        }).catch(() => undefined);
      }
      throw error;
    }
  },
};

function isExpectedValidationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /^(Unknown Foresight planner tool|Foresight planner tool is disabled|Unexpected planner tool arguments|businessId is required|recommendationId must|limit must|states must|Unsupported recommendation state|from and to must|commerce date range must)/.test(error.message);
}