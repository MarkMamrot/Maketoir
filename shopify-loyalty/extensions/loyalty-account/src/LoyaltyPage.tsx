import '@shopify/ui-extensions/preact';
import {render} from 'preact';

import {useLoyalty} from './useLoyalty';

export default function extension() {
  render(<LoyaltyPage />, document.body);
}

function LoyaltyPage() {
  const state = useLoyalty();
  if (state.status === 'loading') return <s-page heading="Rewards"><s-text>Loading loyalty details...</s-text></s-page>;
  if (state.status === 'failed') return <s-page heading="Rewards"><s-banner tone="warning">Loyalty details are temporarily unavailable.</s-banner></s-page>;

  const {loyalty} = state;
  if (!loyalty.programActive) {
    return <s-page heading={loyalty.programName}><s-text>This loyalty program is not currently active.</s-text></s-page>;
  }
  if (!loyalty.member) {
    return <s-page heading={loyalty.programName}><s-text>Loyalty membership is not enabled for this account.</s-text></s-page>;
  }

  return (
    <s-page heading={loyalty.programName}>
      <s-stack direction="block" gap="large">
        <s-section>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Your balance</s-text>
            <s-heading>{loyalty.balancePoints.toLocaleString()} {loyalty.pointsLabel}</s-heading>
          </s-stack>
        </s-section>
        <s-section>
          <s-stack direction="block" gap="base">
            <s-heading>Available rewards</s-heading>
            {loyalty.rewards.length === 0 ? (
              <s-text color="subdued">There are no rewards available right now.</s-text>
            ) : loyalty.rewards.map(reward => (
              <s-box key={reward.code} padding="base" border="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-text type="strong">{reward.name}</s-text>
                  <s-text color="subdued">{reward.pointsCost.toLocaleString()} {loyalty.pointsLabel} · ${reward.valueAud.toFixed(2)} value</s-text>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}
