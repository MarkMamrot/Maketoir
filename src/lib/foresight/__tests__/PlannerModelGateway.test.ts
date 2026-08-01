import { describe, expect, it, vi } from 'vitest';

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class GoogleGenAI {
    models = { generateContent: mockGenerateContent };
  },
}));

import { createGeminiPlannerModelGateway } from '../assistant/PlannerModelGateway';

describe('PlannerModelGateway', () => {
  it('requests JSON using the versioned system prompt and parses fenced fallback output', async () => {
    mockGenerateContent.mockResolvedValue({ text: '```json\n{"toolCalls":[]}\n```' });
    const gateway = createGeminiPlannerModelGateway('test-key');

    await expect(gateway.generateJson({
      modelId: 'gemini-test', systemInstruction: 'Governed prompt', prompt: '{"task":"plan"}',
    })).resolves.toEqual({ toolCalls: [] });

    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: 'gemini-test',
      contents: '{"task":"plan"}',
      config: { systemInstruction: 'Governed prompt', responseMimeType: 'application/json' },
    });
  });
});