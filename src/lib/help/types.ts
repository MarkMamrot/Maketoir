import type { AssistantAudience } from '@/lib/assistant/policy';

export type HelpProduct = 'dashboard' | 'foresight' | 'ims' | 'pos' | 'wholesale' | 'setup' | 'shared';
export type OperationCapability = 'xero' | 'shopify' | 'native_shop';
export type AvailableOperationCapabilities = Partial<Record<OperationCapability, boolean>>;

export type HelpCategory = 'getting-started' | 'products' | 'sales' | 'purchasing' | 'contacts'
  | 'locations-stock' | 'finances' | 'reports' | 'integrations' | 'automations'
  | 'settings' | 'pos' | 'wholesale' | 'reference' | 'platform';

export interface HelpNavigation {
  category: HelpCategory;
  label: string;
  subgroup?: string;
  sections?: Array<{ heading: string; label: string }>;
}

export interface HelpSection {
  id: string;
  heading: string;
  content: string;
  presentation: 'quick' | 'detail';
}

export interface HelpTopic {
  id: string;
  title: string;
  audiences: AssistantAudience[];
  capability: string;
  requiresCapabilities?: OperationCapability[];
  screen: string;
  product: HelpProduct;
  navigation: HelpNavigation;
  requiredTier?: 'SuperAdmin';
  parentId?: string | null;
  relatedTopics?: string[];
  contexts: string[];
  contextSections?: Record<string, string>;
  quickSections: string[];
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