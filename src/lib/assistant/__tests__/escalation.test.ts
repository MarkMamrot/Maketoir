import { describe, expect, it, vi } from 'vitest';

import { escalateBlockedAssistantRequest, type AssistantEscalationDependencies } from '../escalation';

function dependencies(): AssistantEscalationDependencies {
  return {
    reportRuntimeIssue: vi.fn().mockResolvedValue(7),
    reportWorkflowFinding: vi.fn().mockResolvedValue(8),
    createEscalation: vi.fn().mockResolvedValue({ publicReference: 'SOL-ABC12345' }),
    deliverRuntimeAlert: vi.fn().mockResolvedValue(true),
    deliverFindingAlert: vi.fn().mockResolvedValue(true),
  };
}

describe('blocked assistant request escalation', () => {
  it('persists a technical case before delivering its developer alert', async () => {
    const mocks = dependencies();
    const order: string[] = [];
    vi.mocked(mocks.createEscalation).mockImplementation(async () => {
      order.push('case');
      return { publicReference: 'SOL-ABC12345' };
    });
    vi.mocked(mocks.deliverRuntimeAlert).mockImplementation(async () => {
      order.push('alert');
      return true;
    });

    const result = await escalateBlockedAssistantRequest({
      kind: 'technical_blocker',
      businessId: 'biz-1',
      audience: 'ims',
      actorType: 'ims_user',
      actorId: 4,
      canFollowUpDirectly: true,
      runtimeIssue: { source: 'assistant', operation: 'tool', title: 'Tool failed', error: new Error('failed') },
    }, mocks);

    expect(order).toEqual(['case', 'alert']);
    expect(result).toEqual(expect.objectContaining({ escalated: true, publicReference: 'SOL-ABC12345' }));
    expect(vi.mocked(mocks.reportRuntimeIssue).mock.calls[0][0]).toEqual(expect.objectContaining({
      notifyDevelopers: true,
      deferAlert: true,
    }));
  });

  it('uses candidate-workflow copy for a qualified workflow blocker', async () => {
    const mocks = dependencies();
    const result = await escalateBlockedAssistantRequest({
      kind: 'workflow_blocker',
      businessId: 'biz-1',
      audience: 'wholesale',
      actorType: 'wholesale_member',
      actorId: 9,
      canFollowUpDirectly: true,
      workflowFinding: {
        businessId: 'ignored-and-overridden',
        impact: 'high',
        evidence: {
          category: 'missing_capability', audience: 'wholesale', capability: 'orders',
          goal: 'Complete required workflow', essentialConstraints: ['Required constraint'],
          alternativesChecked: [], userConfirmedBlocked: true,
        },
      },
    }, mocks);

    expect(result.message).toContain('supported workflow');
    expect(mocks.deliverFindingAlert).toHaveBeenCalledWith(8);
  });

  it('does not claim escalation when the user case cannot be persisted', async () => {
    const mocks = dependencies();
    vi.mocked(mocks.createEscalation).mockRejectedValueOnce(new Error('database unavailable'));

    const result = await escalateBlockedAssistantRequest({
      kind: 'technical_blocker',
      businessId: 'biz-1',
      audience: 'pos',
      actorType: 'pos_user',
      actorId: 4,
      canFollowUpDirectly: false,
      runtimeIssue: { source: 'assistant', operation: 'tool', title: 'Tool failed', error: 'failed' },
    }, mocks);

    expect(result.escalated).toBe(false);
    expect(result.message).not.toContain('escalated');
    expect(mocks.deliverRuntimeAlert).toHaveBeenCalledWith(7);
  });
});