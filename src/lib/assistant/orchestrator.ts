import { GoogleGenAI } from '@google/genai';

import { retrieveAssistantKnowledge } from './knowledge';
import { loadAssistantPrompt } from './promptManifest';
import { getAssistantToolDefinitions, executeAssistantTool, type AssistantPrincipal } from './tools';
import type { WorkflowFindingCategory } from './policy';
import type { AssistantScreenContext } from './screenContext';

export interface AssistantChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantCitation {
  title: string;
  section: string;
  screen: string;
  topicId?: string;
  sectionId?: string;
}

export interface AssistantWorkflowCandidate {
  category: WorkflowFindingCategory;
  capability: string;
  goal: string;
  essentialConstraints: string[];
  attemptedPath: string | null;
  alternativesChecked: Array<{ path: string; limitation: string | null }>;
}

export interface AssistantResponse {
  answer: string;
  citations: AssistantCitation[];
  model: string;
  promptVersion: string;
  indexVersion: string;
  toolUsed: string | null;
  workflowCandidate: AssistantWorkflowCandidate | null;
}

interface ModelDecision {
  mode?: string;
  answer?: string;
  sourceIds?: unknown;
  tool?: string;
  arguments?: unknown;
  candidate?: Record<string, unknown>;
}

const FINDING_CATEGORIES = new Set<WorkflowFindingCategory>([
  'logical_flow_error', 'workflow_gap', 'missing_capability', 'edge_case', 'documentation_gap',
]);

function parseDecision(text: string): ModelDecision {
  const parsed = JSON.parse(text) as ModelDecision;
  if (!parsed || typeof parsed !== 'object') throw new Error('Assistant model returned an invalid response.');
  return parsed;
}

function boundedAnswer(value: unknown): string {
  return String(value ?? '').trim().slice(0, 2_000);
}

function normalizeCandidate(value: Record<string, unknown> | undefined): AssistantWorkflowCandidate | null {
  if (!value || !FINDING_CATEGORIES.has(value.category as WorkflowFindingCategory)) return null;
  const goal = boundedAnswer(value.goal).slice(0, 500);
  const capability = boundedAnswer(value.capability).slice(0, 100);
  if (!goal || !capability) return null;
  return {
    category: value.category as WorkflowFindingCategory,
    capability,
    goal,
    essentialConstraints: Array.isArray(value.essentialConstraints)
      ? value.essentialConstraints.slice(0, 12).map(item => boundedAnswer(item).slice(0, 250)).filter(Boolean)
      : [],
    attemptedPath: value.attemptedPath ? boundedAnswer(value.attemptedPath).slice(0, 500) : null,
    alternativesChecked: Array.isArray(value.alternativesChecked)
      ? value.alternativesChecked.slice(0, 12).map(item => {
        const alternative = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        return { path: boundedAnswer(alternative.path).slice(0, 250), limitation: alternative.limitation ? boundedAnswer(alternative.limitation).slice(0, 500) : null };
      }).filter(item => item.path)
      : [],
  };
}

function promptContext(input: {
  message: string;
  history: AssistantChatMessage[];
  currentView?: string | null;
  screenContext?: AssistantScreenContext | null;
  knowledge: ReturnType<typeof retrieveAssistantKnowledge>;
  tools: ReturnType<typeof getAssistantToolDefinitions>;
  toolResult?: { name: string; result: unknown } | null;
}) {
  return JSON.stringify({
    currentView: input.currentView?.slice(0, 100) ?? null,
    visibleScreen: input.screenContext ?? null,
    recentConversation: input.history.slice(-6).map(message => ({ role: message.role, content: message.content.slice(0, 1_000) })),
    userMessage: input.message.slice(0, 2_000),
    knowledge: input.knowledge.map(chunk => ({ id: chunk.id, title: chunk.title, heading: chunk.heading, screen: chunk.screen, content: chunk.content })),
    allowedTools: input.tools.map(tool => ({ name: tool.name, description: tool.description, arguments: tool.arguments })),
    toolResult: input.toolResult ?? null,
  });
}

export async function runAssistant(input: {
  principal: AssistantPrincipal;
  message: string;
  history?: AssistantChatMessage[];
  currentView?: string | null;
  screenContext?: AssistantScreenContext | null;
}): Promise<AssistantResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Assistant provider is not configured.');
  const model = process.env.SOLVANTIS_ASSISTANT_MODEL || 'gemini-2.5-flash';
  const prompt = await loadAssistantPrompt();
  const knowledge = retrieveAssistantKnowledge({
    query: input.message,
    audience: input.principal.audience,
    currentView: input.currentView,
    limit: 5,
  });
  const tools = getAssistantToolDefinitions(input.principal.audience);
  const ai = new GoogleGenAI({ apiKey });
  const request = async (toolResult?: { name: string; result: unknown } | null) => {
    const response = await ai.models.generateContent({
      model,
      contents: promptContext({
        message: input.message,
        history: input.history ?? [],
        currentView: input.currentView,
        screenContext: input.screenContext,
        knowledge,
        tools: toolResult ? [] : tools,
        toolResult,
      }),
      config: {
        systemInstruction: prompt.content,
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: 1_000,
      },
    });
    return parseDecision(response.text ?? '');
  };

  let decision = await request();
  let toolUsed: string | null = null;
  if (decision.mode === 'tool') {
    const tool = tools.find(item => item.name === decision.tool);
    if (!tool) throw new Error('Assistant requested an unauthorized tool.');
    const args = decision.arguments && typeof decision.arguments === 'object' && !Array.isArray(decision.arguments)
      ? decision.arguments as Record<string, unknown>
      : {};
    const result = await executeAssistantTool(input.principal, tool.name, args);
    toolUsed = tool.name;
    decision = await request({ name: tool.name, result });
  }

  const allowedSources = new Map(knowledge.map(chunk => [chunk.id, chunk]));
  const sourceIds = Array.isArray(decision.sourceIds) ? decision.sourceIds.slice(0, 4).map(String) : [];
  const citations = sourceIds.flatMap(sourceId => {
    const source = allowedSources.get(sourceId);
    return source ? [{
      title: source.title,
      section: source.heading,
      screen: source.screen,
      topicId: source.topicId,
      sectionId: source.topicId ? source.id : undefined,
    }] : [];
  });
  const candidate = decision.mode === 'workflow_candidate' ? normalizeCandidate(decision.candidate) : null;
  const answer = boundedAnswer(decision.answer);
  if (!answer) throw new Error('Assistant returned an empty answer.');
  return {
    answer,
    citations,
    model,
    promptVersion: prompt.version,
    indexVersion: '1',
    toolUsed,
    workflowCandidate: candidate,
  };
}

export const assistantOrchestratorInternals = { parseDecision, normalizeCandidate };