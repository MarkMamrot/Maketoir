import type { AssistantAudience } from '@/lib/assistant/policy';

export type HelpProduct = 'dashboard' | 'foresight' | 'ims' | 'pos' | 'wholesale' | 'setup' | 'shared';
export type OperationCapability = 'xero' | 'shopify' | 'native_shop';
export type AvailableOperationCapabilities = Partial<Record<OperationCapability, boolean>>;

export interface HelpSection {
  id: string;
  heading: string;
  content: string;
}

export interface HelpTopic {
  id: string;
  title: string;
  audiences: AssistantAudience[];
  capability: string;
  requiresCapabilities?: OperationCapability[];
  screen: string;
  product: HelpProduct;
  parentId?: string | null;
  relatedTopics?: string[];
  contexts: string[];
  contextSections?: Record<string, string>;
  order?: number;
  summary: string;
  lastReviewed: string;
  owner: string;
  filename: string;
  sections: HelpSection[];
}

export interface ResolvedHelpContext {
  topic: HelpTopic;
  sectionId: string | null;
  exact: boolean;
}