import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockStart, mockComplete, mockExecute, mockReport } = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockComplete: vi.fn(),
  mockExecute: vi.fn(),
  mockReport: vi.fn(),
}));

vi.mock('../repositories/ForesightPlanningRepository', () => ({
  ForesightPlanningRepository: { startToolCall: mockStart, completeToolCall: mockComplete },
}));
vi.mock('../assistant/plannerToolRegistry', () => ({ executeForesightPlannerTool: mockExecute }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReport }));

import { ForesightPlannerToolService } from '../assistant/ForesightPlannerToolService';

describe('ForesightPlannerToolService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStart.mockResolvedValue(71);
    mockComplete.mockResolvedValue(undefined);
    mockReport.mockResolvedValue(91);
  });

  it('audits successful read-tool results with their fact IDs', async () => {
    mockExecute.mockResolvedValue({
      tool: 'get_marketing_strategy', manifestVersion: 'foresight-planner-tools-v1', truncated: false,
      facts: [{ factId: 'foresight:strategy:4:v2' }],
    });

    await expect(ForesightPlannerToolService.execute({
      businessId: 'business-1', threadId: 12, messageId: 30,
      enabledTools: ['get_marketing_strategy'], name: 'get_marketing_strategy',
    })).resolves.toMatchObject({ tool: 'get_marketing_strategy' });

    expect(mockStart).toHaveBeenCalledWith('business-1', 12, {
      toolName: 'get_marketing_strategy', arguments: {}, messageId: 30,
    });
    expect(mockComplete).toHaveBeenCalledWith('business-1', 71, expect.objectContaining({
      state: 'succeeded', factIds: ['foresight:strategy:4:v2'],
    }));
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('records and reports operational failures without exposing arguments', async () => {
    mockExecute.mockRejectedValue(new Error('Database unavailable'));

    await expect(ForesightPlannerToolService.execute({
      businessId: 'business-1', threadId: 12,
      enabledTools: ['get_recommendation'], name: 'get_recommendation',
      args: { recommendationId: 20 },
    })).rejects.toThrow('Database unavailable');

    expect(mockComplete).toHaveBeenCalledWith('business-1', 71, expect.objectContaining({
      state: 'failed', errorText: 'Database unavailable', factIds: [],
    }));
    expect(mockReport).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', source: 'ForesightPlanner', operation: 'execute_read_tool',
      context: { toolName: 'get_recommendation', toolCallId: 71 },
    }));
  });

  it('does not report expected allowlist validation failures as runtime issues', async () => {
    mockExecute.mockRejectedValue(new Error('Foresight planner tool is disabled: get_business_context'));

    await expect(ForesightPlannerToolService.execute({
      businessId: 'business-1', threadId: 12,
      enabledTools: [], name: 'get_business_context',
    })).rejects.toThrow('disabled');

    expect(mockComplete).toHaveBeenCalledWith('business-1', 71, expect.objectContaining({ state: 'failed' }));
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('does not report invalid commerce date arguments as runtime issues', async () => {
    mockExecute.mockRejectedValue(new Error('commerce date range must contain 1 to 90 days'));

    await expect(ForesightPlannerToolService.execute({
      businessId: 'business-1', threadId: 12,
      enabledTools: ['get_commerce_performance'], name: 'get_commerce_performance',
      args: { from: '2026-01-01', to: '2026-04-01' },
    })).rejects.toThrow('1 to 90 days');

    expect(mockComplete).toHaveBeenCalledWith('business-1', 71, expect.objectContaining({ state: 'failed' }));
    expect(mockReport).not.toHaveBeenCalled();
  });
});