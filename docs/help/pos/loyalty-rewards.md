---
{"id":"pos-loyalty-rewards","title":"Loyalty Rewards at POS","audiences":["pos","ims"],"capability":"pos","screen":"POS > Customer > Loyalty","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-customers","pos-selling-payments-manager-approval","pos-store-credit"],"contexts":["pos-loyalty"],"contextSections":{"pos-loyalty":"Step-by-step"},"order":14,"summary":"Check a linked customer's loyalty balance and apply an eligible reward to an ordinary online sale.","lastReviewed":"2026-08-31","owner":"retail"}
---
# Loyalty Rewards at POS

Use the loyalty panel under a linked customer to confirm membership, points, and rewards before checkout.

## Main operations

- Link the customer whose loyalty account will be used.
- Read the current program and points balance.
- Select one reward when the customer has enough points and eligible merchandise.
- Remove a selected reward before payment when required.
- Complete the sale online so the reward and points are recorded together.

## At a glance

| Requirement | Reward availability |
|---|---|
| Customer linked and enrolled | Required |
| Program enabled and started | Required |
| Enough points for the reward | Required |
| Eligible positive-value merchandise covers the reward value | Required |
| Ordinary sale, online, outside Training Mode | Required |
| Layby or return cart | Reward unavailable |

## Before you begin

- [ ] Link the correct customer.
- [ ] Confirm POS is online.
- [ ] Add the eligible merchandise before selecting the reward.
- [ ] Check that the cart is an ordinary sale, not a layby or return.

> **Note:** A points balance alone does not guarantee that a reward can be used. The cart must also contain enough eligible merchandise to cover the reward value.

## Step-by-step

1. Open **Customer** and link the correct customer.
2. Wait for the loyalty panel to show the program name and current points balance.
3. Review the rewards shown beneath the balance.
4. Add eligible merchandise until the **Use** button is available for the requested reward.
5. Choose **Use**. The reward appears as a discount in the cart totals.
6. Recheck the final tax-inclusive total.
7. Take payment and complete the sale while online.
8. To change the choice before completion, choose **Remove** and select another eligible reward if available.

## Troubleshooting

| Message or symptom | Meaning | What to do |
|---|---|---|
| Loyalty program is switched off | The business is not currently offering POS rewards | Continue without a reward |
| Program has not started yet | Its configured start time has not arrived | Continue without a reward |
| Customer is not a loyalty member | The linked customer is not enrolled | Do not enrol without consent; follow the business's enrolment process |
| **Use** is disabled despite enough points | The cart has insufficient eligible value, contains a return, or is a layby | Correct the cart or continue without the reward |
| Loyalty details require an online connection | POS cannot validate the current balance | Reconnect; do not estimate or manually promise points |
| Selected reward becomes invalid | The cart changed after selection | Remove the reward or restore enough eligible merchandise before completing |

## Worked examples

### Apply a $10 reward

Taylor has enough points for a $10 reward and buys $65 of eligible merchandise. Staff link Taylor, choose **Use** beside the reward, and confirm the total falls by $10. They complete the sale online so the redemption and sale are recorded together.
