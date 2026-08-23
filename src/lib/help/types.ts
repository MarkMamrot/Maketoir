import type { AssistantAudience } from '@/lib/assistant/policy';

export type HelpProduct = 'dashboard' | 'foresight' | 'ims' | 'pos' | 'wholesale' | 'setup' | 'shared';

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
  screen: string;
  product: HelpProduct;
  parentId?: string | null;
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