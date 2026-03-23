// Placeholder for standardizing data schemas
export interface StandardizedProduct {
  id: string; // Internal mapping ID
  platformId: string; // ID from Shopify
  name: string;
  category: string;
  price: number;
  cost: number;
  grossMargin: number; // User-defined or calculated
  imageUrl?: string;
}

export interface StandardizedCreative {
  id: string;
  platformIds: Record<string, string>; // { meta: '123', google: 'abc' }
  type: 'video' | 'image' | 'text';
  url?: string;
  content?: string;
  tags: string[]; // AI-generated tags (color, hook, etc.)
  status: 'learning' | 'scaling' | 'paused';
}

export interface MetricSummary {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cpa: number;
  roas: number;
}
