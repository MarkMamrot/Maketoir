---
{"id":"pos-laybys","title":"Laybys at POS","audiences":["pos","ims"],"capability":"pos","screen":"POS > More > Layby","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-selling-payments-manager-approval","pos-reports-transactions","pos-settings-terminals-offline-recovery"],"contexts":["pos-layby"],"contextSections":{"pos-layby":"Step-by-step"},"order":22,"summary":"Mark the current cart as a layby and save the currently supported fully allocated layby transaction.","lastReviewed":"2026-08-31","owner":"retail"}
---
# Laybys at POS

Use Layby mode only after confirming that the current POS workflow matches the customer's arrangement.

## Main operations

- Mark the current positive cart as a layby.
- Review the tax-inclusive layby total.
- Allocate payment lines to the full displayed amount.
- Save the transaction with active layby status.
- Recognise that later instalment collection is not available in the current POS workflow.

## At a glance

| Current behavior | Available? |
|---|---|
| Mark a cart as Layby | Yes |
| Save after payment lines cover the full displayed amount | Yes |
| Save with an unallocated remaining balance | No |
| Collect later partial instalments against the layby in POS | No |
| Apply a loyalty reward | No |
| Use Layby in Training Mode | No |

## Before you begin

- [ ] Confirm the register is open and POS is online.
- [ ] Confirm the cart contains ordinary positive-quantity merchandise.
- [ ] Explain the store's layby terms to the customer.
- [ ] Confirm the customer understands the current payment requirement before proceeding.

> **Important:** The current POS layby screen does not support saving an unpaid balance for later instalments. **Save Layby** becomes available only after payment lines allocate the full displayed amount.

## Step-by-step

1. Build and check the cart.
2. Open **More** and choose **Layby: Off** so it changes to **Layby: ON**.
3. Confirm the main checkout button now says **Layby**.
4. Choose the Layby button to open **Layby Deposit**.
5. Add one or more payment lines until **Remaining** is zero.
6. Choose **Save Layby**.
7. Keep the receipt and transaction reference according to store procedure.
8. Open **More > Layby: ON** again to turn Layby mode off before starting an ordinary sale.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Layby is unavailable | Training Mode is active | Leave Training Mode before handling a live layby |
| **Save Layby** is disabled | Payment lines do not cover the full displayed amount | Correct the payment allocation until **Remaining** is zero |
| A loyalty reward cannot be selected | Rewards are unavailable on layby carts | Remove the reward and follow the business's layby policy |
| Staff need to take a later instalment | The current POS workflow has no instalment collection action | Stop and follow the business's approved manual process; do not enter a second sale as the same layby |
| The next cart still says Layby | Layby mode remained on | Turn **Layby: ON** off before building the next sale |

## Worked examples

### Do not promise a later POS instalment

A customer asks to pay $50 now against a $200 cart and return next week. The payment window cannot save while $150 remains. Staff stop and follow the store's approved alternative rather than completing a misleading second transaction or promising that POS can collect the later balance.
