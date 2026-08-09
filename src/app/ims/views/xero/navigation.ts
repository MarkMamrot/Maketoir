export type XeroDestination =
  | 'overview'
  | 'setup-automation'
  | 'setup-ledger'
  | 'setup-payments'
  | 'activity-history'
  | 'activity-cogs'
  | 'activity-payouts';

export type XeroWorkspaceSection = 'overview' | 'setup' | 'activity';

const CANONICAL_HASHES: Record<XeroDestination, string> = {
  overview: '#xero/overview',
  'setup-automation': '#xero/setup/automation',
  'setup-ledger': '#xero/setup/ledger',
  'setup-payments': '#xero/setup/payments',
  'activity-history': '#xero/activity/history',
  'activity-cogs': '#xero/activity/cogs',
  'activity-payouts': '#xero/activity/payouts',
};

const HASH_DESTINATIONS = new Map<string, XeroDestination>([
  ...Object.entries(CANONICAL_HASHES).map(([destination, hash]) => [hash.slice(1), destination as XeroDestination] as const),
  ['xero', 'overview'],
  ['xero/mapping', 'setup-ledger'],
  ['xero/sync', 'activity-history'],
  ['xero/cogs', 'activity-cogs'],
  ['xero/payouts', 'activity-payouts'],
]);

export function parseXeroHash(hash: string): XeroDestination {
  const normalized = hash.trim().replace(/^#/, '').replace(/\/$/, '').toLowerCase();
  return HASH_DESTINATIONS.get(normalized) ?? 'overview';
}

export function getXeroHash(destination: XeroDestination): string {
  return CANONICAL_HASHES[destination];
}

export function getXeroWorkspaceSection(destination: XeroDestination): XeroWorkspaceSection {
  if (destination.startsWith('setup-')) return 'setup';
  if (destination.startsWith('activity-')) return 'activity';
  return 'overview';
}

export function isXeroHash(hash: string): boolean {
  const normalized = hash.trim().replace(/^#/, '').toLowerCase();
  return normalized === 'xero' || normalized.startsWith('xero/');
}