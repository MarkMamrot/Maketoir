import '@shopify/ui-extensions/preact';
import {useApi} from '@shopify/ui-extensions/customer-account/preact';
import {render} from 'preact';
import {useRef, useState} from 'preact/hooks';

import {claimLoyaltyReward, type LoyaltyClaimResult, type LoyaltyReward} from './loyalty';
import {useLoyalty} from './useLoyalty';

export default function extension() {
  render(<LoyaltyPage />, document.body);
}

function LoyaltyPage() {
  const api = useApi<'customer-account.page.render'>();
  const state = useLoyalty();
  const [claimingRewardId, setClaimingRewardId] = useState<number | null>(null);
  const [claimErrors, setClaimErrors] = useState<Record<number, string>>({});
  const [issuedRewards, setIssuedRewards] = useState<Record<number, LoyaltyClaimResult>>({});
  const [balanceAfterClaim, setBalanceAfterClaim] = useState<number | null>(null);
  const requestKeys = useRef<Record<number, string>>({});

  async function claim(reward: LoyaltyReward) {
    if (!reward.rewardId || claimingRewardId !== null) return;
    setClaimingRewardId(reward.rewardId);
    setClaimErrors(previous => ({...previous, [reward.rewardId!]: ''}));
    const requestKey = requestKeys.current[reward.rewardId]
      ?? `claim_${crypto.randomUUID().replace(/-/g, '')}`;
    requestKeys.current[reward.rewardId] = requestKey;
    try {
      const token = await api.sessionToken.get();
      const redemption = await claimLoyaltyReward({
        rewardId: reward.rewardId,
        idempotencyKey: requestKey,
        sessionToken: token,
      });
      setIssuedRewards(previous => ({...previous, [reward.rewardId!]: redemption}));
      setBalanceAfterClaim(redemption.balanceAfter);
    } catch (error) {
      setClaimErrors(previous => ({
        ...previous,
        [reward.rewardId!]: error instanceof Error ? error.message : 'The reward could not be issued.',
      }));
    } finally {
      setClaimingRewardId(null);
    }
  }

  if (state.status === 'loading') return <s-page heading="Rewards"><s-text>Loading loyalty details...</s-text></s-page>;
  if (state.status === 'failed') return <s-page heading="Rewards"><s-banner tone="warning">Loyalty details are temporarily unavailable.</s-banner></s-page>;

  const {loyalty} = state;
  if (!loyalty.programActive) {
    return <s-page heading={loyalty.programName}><s-text>This loyalty program is not currently active.</s-text></s-page>;
  }
  if (!loyalty.member) {
    return <s-page heading={loyalty.programName}><s-text>Loyalty membership is not enabled for this account.</s-text></s-page>;
  }
  const currentBalance = balanceAfterClaim ?? loyalty.balancePoints;

  return (
    <s-page heading={loyalty.programName}>
      <s-stack direction="block" gap="large">
        <s-section>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Your balance</s-text>
            <s-heading>{currentBalance.toLocaleString()} {loyalty.pointsLabel}</s-heading>
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
                  {reward.rewardId ? (
                    <s-button
                      commandFor={`claim-reward-${reward.rewardId}`}
                      command="--show"
                      disabled={currentBalance < reward.pointsCost || claimingRewardId !== null}
                    >
                      {currentBalance < reward.pointsCost ? 'Not enough points' : 'Claim reward'}
                    </s-button>
                  ) : (
                    <s-text color="subdued">Reward claiming will be available after your loyalty details refresh.</s-text>
                  )}
                </s-stack>
                {reward.rewardId && (
                  <s-modal id={`claim-reward-${reward.rewardId}`} heading={issuedRewards[reward.rewardId] ? 'Reward issued' : `Claim ${reward.name}?`} size="small">
                    {issuedRewards[reward.rewardId] ? (
                      <s-stack direction="block" gap="base">
                        <s-banner tone="success">Your reward code is ready.</s-banner>
                        <s-text type="strong">{issuedRewards[reward.rewardId].voucherCode}</s-text>
                        <s-text color="subdued">Use this single-use code at checkout before it expires.</s-text>
                        <s-button slot="primary-action" commandFor={`claim-reward-${reward.rewardId}`} command="--hide">Done</s-button>
                      </s-stack>
                    ) : (
                      <s-stack direction="block" gap="base">
                        <s-text>Exchange {reward.pointsCost.toLocaleString()} {loyalty.pointsLabel} for {reward.name}. This creates a single-use Shopify checkout code.</s-text>
                        {claimErrors[reward.rewardId] && <s-banner tone="critical">{claimErrors[reward.rewardId]}</s-banner>}
                        <s-button
                          slot="primary-action"
                          variant="primary"
                          loading={claimingRewardId === reward.rewardId}
                          disabled={claimingRewardId !== null}
                          onClick={() => claim(reward)}
                        >
                          Confirm claim
                        </s-button>
                        <s-button slot="secondary-actions" commandFor={`claim-reward-${reward.rewardId}`} command="--hide">Cancel</s-button>
                      </s-stack>
                    )}
                  </s-modal>
                )}
              </s-box>
            ))}
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}
