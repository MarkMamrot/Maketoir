export type ProspectFit = 'strong_fit' | 'possible_fit' | 'needs_discovery' | 'not_fit';
export type ProspectIntent = 'researching' | 'evaluating' | 'high_intent';
export type ProspectLeadStatus = 'new' | 'contacting' | 'qualified' | 'demo_booked' | 'won' | 'lost' | 'spam';
export type ProspectPreferredContact = 'email' | 'phone' | 'sms';
export type IntegrationDeliveryMode = 'native' | 'on_demand' | 'beta' | 'not_offered';

export interface ProspectChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProspectKnowledgeSource {
  id: string;
  title: string;
  summary: string;
  capabilities: string[];
  product: string;
}

export interface ProspectAssistantDecision {
  answer: string;
  sourceIds: string[];
  followUpQuestion: string | null;
  fit: ProspectFit;
  intent: ProspectIntent;
  requestedIntegration: string | null;
  requestedProvider: string | null;
  unmetNeed: string | null;
  offerContact: boolean;
}

export interface ProspectAssistantResponse extends ProspectAssistantDecision {
  conversationId: string;
  messageCount: number;
}

export interface ProspectLeadInput {
  conversationId?: string | null;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  preferredContact: ProspectPreferredContact;
  consentEmail: boolean;
  consentPhone: boolean;
  consentSms: boolean;
  locations?: string | null;
  currentSystems?: string | null;
  timeframe?: string | null;
  sourcePath?: string | null;
}

export interface PublicIntegrationOffering {
  id: number;
  slug: string;
  name: string;
  category: string;
  deliveryMode: Exclude<IntegrationDeliveryMode, 'not_offered'>;
  publicSummary: string;
  exampleProviders: string[];
  supportedWorkflows: string[];
  qualificationQuestions: string[];
}