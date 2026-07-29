export const DEFAULT_KLAVIYO_REVISION = '2024-10-15';

const KLAVIYO_BASE_URL = 'https://a.klaviyo.com/api';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export interface KlaviyoCampaignRecord {
  id: string;
  name: string;
  status: string;
  archived: string;
  send_time: string;
  scheduled_at: string;
  created_at: string;
  updated_at: string;
}

export interface KlaviyoFlowRecord {
  id: string;
  name: string;
  status: string;
  archived: string;
  trigger_type: string;
  created: string;
  updated: string;
}

export interface KlaviyoListRecord {
  id: string;
  name: string;
  created: string;
  updated: string;
}

interface KlaviyoResource {
  id?: unknown;
  attributes?: Record<string, unknown>;
}

interface KlaviyoCollectionResponse {
  data?: KlaviyoResource[];
  links?: { next?: string | null };
  errors?: Array<{ detail?: string; title?: string }>;
}

export interface KlaviyoServiceOptions {
  revision?: string;
  fetcher?: typeof fetch;
  sleeper?: (milliseconds: number) => Promise<void>;
  maxRetries?: number;
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelayMilliseconds(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return retryAfter * 1000;
  return Math.min(250 * 2 ** attempt, 2_000);
}

export class KlaviyoService {
  readonly revision: string;
  private readonly fetcher: typeof fetch;
  private readonly sleeper: (milliseconds: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(
    private readonly apiKey: string,
    options: KlaviyoServiceOptions = {},
  ) {
    if (!apiKey) throw new Error('Klaviyo API key is required.');
    this.revision = options.revision ?? process.env.KLAVIYO_API_REVISION ?? DEFAULT_KLAVIYO_REVISION;
    this.fetcher = options.fetcher ?? fetch;
    this.sleeper = options.sleeper ?? sleep;
    this.maxRetries = options.maxRetries ?? 3;
  }

  private headers(): HeadersInit {
    return {
      Accept: 'application/json',
      Authorization: `Klaviyo-API-Key ${this.apiKey}`,
      revision: this.revision,
    };
  }

  private async fetchPage(url: string): Promise<KlaviyoCollectionResponse> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetcher(url, { headers: this.headers() });
      const body = await response.json().catch(() => ({})) as KlaviyoCollectionResponse;
      if (response.ok) return body;

      if (RETRYABLE_STATUSES.has(response.status) && attempt < this.maxRetries) {
        await this.sleeper(retryDelayMilliseconds(response, attempt));
        continue;
      }

      const detail = body.errors?.[0]?.detail ?? body.errors?.[0]?.title ?? `HTTP ${response.status}`;
      throw new Error(`Klaviyo request failed: ${detail}`);
    }
  }

  private async getAll(path: string): Promise<KlaviyoResource[]> {
    const records: KlaviyoResource[] = [];
    let nextUrl: string | null = new URL(path, KLAVIYO_BASE_URL).toString();

    while (nextUrl) {
      const page = await this.fetchPage(nextUrl);
      records.push(...(page.data ?? []));
      nextUrl = page.links?.next ?? null;
    }

    return records;
  }

  async getCampaigns(): Promise<KlaviyoCampaignRecord[]> {
    const resources = await this.getAll("campaigns/?filter=equals(messages.channel,'email')&page[size]=100&sort=-created_at");
    return resources.map((item) => {
      const attributes = item.attributes ?? {};
      return {
        id: text(item.id),
        name: text(attributes.name),
        status: text(attributes.status),
        archived: text(attributes.archived ?? false),
        send_time: text(attributes.send_time),
        scheduled_at: text(attributes.scheduled_at),
        created_at: text(attributes.created_at),
        updated_at: text(attributes.updated_at),
      };
    });
  }

  async getFlows(): Promise<KlaviyoFlowRecord[]> {
    const resources = await this.getAll('flows/?page[size]=100&sort=-created');
    return resources.map((item) => {
      const attributes = item.attributes ?? {};
      return {
        id: text(item.id),
        name: text(attributes.name),
        status: text(attributes.status),
        archived: text(attributes.archived ?? false),
        trigger_type: text(attributes.trigger_type),
        created: text(attributes.created),
        updated: text(attributes.updated),
      };
    });
  }

  async getLists(): Promise<KlaviyoListRecord[]> {
    const resources = await this.getAll('lists/?page[size]=100');
    return resources.map((item) => {
      const attributes = item.attributes ?? {};
      return {
        id: text(item.id),
        name: text(attributes.name),
        created: text(attributes.created),
        updated: text(attributes.updated),
      };
    });
  }

  async testConnection(): Promise<number> {
    const resources = await this.getAll('metrics/?page[size]=1');
    return resources.length;
  }
}
