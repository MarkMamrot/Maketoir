import capabilitiesJson from './capabilities.json';
import type { AssistantAudience } from './policy';

export interface AssistantCapability {
  id: string;
  title: string;
  audiences: AssistantAudience[];
  screens: string[];
  tools: string[];
}

export const assistantCapabilities = capabilitiesJson as AssistantCapability[];

export function getAssistantCapabilities(audience: AssistantAudience): AssistantCapability[] {
  return assistantCapabilities.filter(capability => capability.audiences.includes(audience));
}