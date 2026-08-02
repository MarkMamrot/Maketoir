import { GoogleGenAI } from '@google/genai';

export interface PlannerModelGateway {
  generateJson(input: {
    modelId: string;
    systemInstruction: string;
    prompt: string;
    media?: { mimeType: string; data: string } | null;
  }): Promise<Record<string, unknown>>;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(cleaned) as unknown;
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Planner model returned a non-object JSON response.');
  }
  return parsed as Record<string, unknown>;
}

export function createGeminiPlannerModelGateway(apiKey: string): PlannerModelGateway {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generateJson(input) {
      const contents = input.media
        ? [{ role: 'user', parts: [
          { inlineData: { mimeType: input.media.mimeType, data: input.media.data } },
          { text: input.prompt },
        ] }]
        : input.prompt;
      const response = await ai.models.generateContent({
        model: input.modelId,
        contents,
        config: {
          systemInstruction: input.systemInstruction,
          responseMimeType: 'application/json',
        },
      });
      return parseJsonObject(response.text ?? '');
    },
  };
}