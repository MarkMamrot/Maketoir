import { createTrackedGoogleGenAI } from '@/lib/ai/billing/googleGateway';

import { retrieveAssistantKnowledge } from './knowledge';
import { getOnlineChannelCapabilities, isXeroAccountingEnabled } from '@/lib/ims/businessOperations';
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
  toolsUsed: string[];
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

interface AssistantToolResult {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
}

const MAX_TOOL_STEPS = 4;

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
  toolResults?: AssistantToolResult[];
  mustAnswer?: boolean;
}) {
  return JSON.stringify({
    currentView: input.currentView?.slice(0, 100) ?? null,
    visibleScreen: input.screenContext ?? null,
    recentConversation: input.history.slice(-6).map(message => ({ role: message.role, content: message.content.slice(0, 1_000) })),
    userMessage: input.message.slice(0, 2_000),
    knowledge: input.knowledge.map(chunk => ({ id: chunk.id, title: chunk.title, heading: chunk.heading, screen: chunk.screen, content: chunk.content })),
    allowedTools: input.mustAnswer ? [] : input.tools.map(tool => ({ name: tool.name, description: tool.description, arguments: tool.arguments })),
    research: {
      completedSteps: input.toolResults ?? [],
      remainingToolSteps: input.mustAnswer ? 0 : Math.max(0, MAX_TOOL_STEPS - (input.toolResults?.length ?? 0)),
      instruction: input.mustAnswer
        ? 'Synthesize the final answer now from the supplied evidence. Do not request another tool.'
        : 'Decide whether another read-only lookup is needed. If evidence is sufficient, synthesize the final answer now.',
    },
  });
}

async function runResearchLoop(input: {
  tools: ReturnType<typeof getAssistantToolDefinitions>;
  request: (toolResults: AssistantToolResult[], mustAnswer: boolean) => Promise<ModelDecision>;
  execute: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
}): Promise<{ decision: ModelDecision; toolResults: AssistantToolResult[] }> {
  const toolResults: AssistantToolResult[] = [];
  const seenCalls = new Set<string>();
  let decision = await input.request(toolResults, false);

  while (decision.mode === 'tool' && toolResults.length < MAX_TOOL_STEPS) {
    const tool = input.tools.find(item => item.name === decision.tool);
    if (!tool) throw new Error('Assistant requested an unauthorized tool.');
    const args = decision.arguments && typeof decision.arguments === 'object' && !Array.isArray(decision.arguments)
      ? decision.arguments as Record<string, unknown>
      : {};
    const signature = `${tool.name}:${JSON.stringify(args)}`;
    if (seenCalls.has(signature)) {
      decision = await input.request(toolResults, true);
      return { decision, toolResults };
    }
    seenCalls.add(signature);
    const result = await input.execute(tool.name, args);
    toolResults.push({ name: tool.name, arguments: args, result });
    decision = await input.request(toolResults, toolResults.length >= MAX_TOOL_STEPS);
  }

  if (decision.mode === 'tool') decision = await input.request(toolResults, true);
  return { decision, toolResults };
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
  const xeroAccountingEnabled = input.principal.audience === 'ims' || input.principal.audience === 'pos'
    ? await isXeroAccountingEnabled(input.principal.businessId).catch(() => false)
    : undefined;
  const onlineChannels = input.principal.audience === 'ims' || input.principal.audience === 'pos'
    ? await getOnlineChannelCapabilities(input.principal.businessId).catch(() => ({ shopifyEnabled: false, nativeShopEnabled: false }))
    : undefined;
  const knowledge = retrieveAssistantKnowledge({
    query: input.message,
    audience: input.principal.audience,
    currentView: input.currentView,
    limit: 5,
    xeroAccountingEnabled,
    availableCapabilities: onlineChannels ? {
      xero: xeroAccountingEnabled,
      shopify: onlineChannels.shopifyEnabled,
      native_shop: onlineChannels.nativeShopEnabled,
    } : undefined,
  });
  const tools = getAssistantToolDefinitions(input.principal.audience);
  const ai = createTrackedGoogleGenAI(apiKey, { businessId: input.principal.businessId, area: 'assistant', operation: 'answer_private_assistant', actorType: 'user' });
  const request = async (toolResults: AssistantToolResult[], mustAnswer: boolean) => {
    const response = await ai.models.generateContent({
      model,
      contents: promptContext({
        message: input.message,
        history: input.history ?? [],
        currentView: input.currentView,
        screenContext: input.screenContext,
        knowledge,
        tools,
        toolResults,
        mustAnswer,
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

  const research = await runResearchLoop({
    tools,
    request,
    execute: (toolName, args) => executeAssistantTool(input.principal, toolName, args),
  });
  const decision = research.decision;
  const toolsUsed = research.toolResults.map(result => result.name);

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
    toolUsed: toolsUsed.at(-1) ?? null,
    toolsUsed,
    workflowCandidate: candidate,
  };
}

export const assistantOrchestratorInternals = { parseDecision, normalizeCandidate, runResearchLoop };