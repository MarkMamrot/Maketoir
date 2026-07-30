export function googleAdsCampaignUrl(customerId: string | null | undefined, campaignId: string): string | null {
  const normalizedCustomerId = String(customerId ?? '').replace(/-/g, '').trim();
  const normalizedCampaignId = String(campaignId).trim();
  if (!/^\d+$/.test(normalizedCustomerId) || !/^\d+$/.test(normalizedCampaignId)) return null;

  const query = new URLSearchParams({
    campaignId: normalizedCampaignId,
    __c: normalizedCustomerId,
  });
  return `https://ads.google.com/aw/campaigns?${query.toString()}`;
}