import '@shopify/ui-extensions/preact';
import {render} from 'preact';

import {useLoyalty} from './useLoyalty';

export default function extension() {
  render(<ProfileBlock />, document.body);
}

function ProfileBlock() {
  const state = useLoyalty();
  if (state.status === 'loading') return <s-text>Loading loyalty details...</s-text>;
  if (state.status === 'failed') return <s-text color="subdued">Loyalty details are temporarily unavailable.</s-text>;
  if (!state.loyalty.programActive) return null;

  const {loyalty} = state;
  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <s-heading>{loyalty.programName}</s-heading>
        {loyalty.member ? (
          <s-stack direction="inline" gap="small">
            <s-badge tone="neutral">Member</s-badge>
            <s-text type="strong">{loyalty.balancePoints.toLocaleString()} {loyalty.pointsLabel}</s-text>
          </s-stack>
        ) : (
          <s-text color="subdued">Loyalty membership is not enabled for this account.</s-text>
        )}
        <s-link href="extension:solvantis-loyalty">View rewards</s-link>
      </s-stack>
    </s-section>
  );
}
