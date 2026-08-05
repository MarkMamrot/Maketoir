export interface LoyaltyReward {
  code: string;
  name: string;
  pointsCost: number;
  valueAud: number;
}

export interface LoyaltyState {
  member: boolean;
  programActive: boolean;
  balancePoints: number;
  programName: string;
  pointsLabel: string;
  rewards: LoyaltyReward[];
}

interface MetafieldValue {
  value?: string | null;
}

interface LoyaltyCustomerQuery {
  customer?: {
    member?: MetafieldValue | null;
    programActive?: MetafieldValue | null;
    balancePoints?: MetafieldValue | null;
    programName?: MetafieldValue | null;
    pointsLabel?: MetafieldValue | null;
    rewards?: MetafieldValue | null;
  } | null;
}

export interface CustomerAccountQueryClient {
  query<T>(query: string, options?: {variables?: Record<string, unknown>}): Promise<{
    data?: T;
    errors?: Array<{message: string}>;
  }>;
}

export function createCustomerAccountClient(fetcher: typeof fetch): CustomerAccountQueryClient {
  return {
    async query<T>(query: string) {
      const response = await fetcher('shopify://customer-account/api/2026-07/graphql.json', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({query}),
      });
      if (!response.ok) throw new Error('Shopify could not load loyalty details.');
      return response.json() as Promise<{data?: T; errors?: Array<{message: string}>}>;
    },
  };
}

export const LOYALTY_QUERY = `#graphql
  query SolvantisLoyaltyCustomer {
    customer {
      member: metafield(namespace: "solvantis_loyalty", key: "member") { value }
      programActive: metafield(namespace: "solvantis_loyalty", key: "program_active") { value }
      balancePoints: metafield(namespace: "solvantis_loyalty", key: "balance_points") { value }
      programName: metafield(namespace: "solvantis_loyalty", key: "program_name") { value }
      pointsLabel: metafield(namespace: "solvantis_loyalty", key: "points_label") { value }
      rewards: metafield(namespace: "solvantis_loyalty", key: "rewards") { value }
    }
  }
`;

function parseRewards(value: string | null | undefined): LoyaltyReward[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const reward = item as Record<string, unknown>;
      const code = typeof reward.code === 'string' ? reward.code : '';
      const name = typeof reward.name === 'string' ? reward.name : '';
      const pointsCost = Number(reward.pointsCost);
      const valueAud = Number(reward.valueAud);
      if (!code || !name || !Number.isInteger(pointsCost) || pointsCost <= 0 || !Number.isFinite(valueAud) || valueAud <= 0) return [];
      return [{code, name, pointsCost, valueAud}];
    });
  } catch {
    return [];
  }
}

export function parseLoyaltyState(data: LoyaltyCustomerQuery | undefined): LoyaltyState {
  const customer = data?.customer;
  const balance = Number(customer?.balancePoints?.value ?? 0);
  return {
    member: customer?.member?.value === 'true',
    programActive: customer?.programActive?.value === 'true',
    balancePoints: Number.isFinite(balance) ? Math.trunc(balance) : 0,
    programName: customer?.programName?.value?.trim() || 'Rewards Program',
    pointsLabel: customer?.pointsLabel?.value?.trim() || 'points',
    rewards: parseRewards(customer?.rewards?.value),
  };
}

export async function loadLoyaltyState(client: CustomerAccountQueryClient): Promise<LoyaltyState> {
  const result = await client.query<LoyaltyCustomerQuery>(LOYALTY_QUERY);
  if (result.errors?.length) throw new Error('Shopify could not load loyalty details.');
  return parseLoyaltyState(result.data);
}
