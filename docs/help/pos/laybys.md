---
{"id":"pos-laybys","title":"Laybys at POS","audiences":["pos","ims"],"capability":"pos","screen":"POS > More > Layby","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-selling-payments-manager-approval","pos-reports-transactions","pos-settings-terminals-offline-recovery","pos-end-of-day-xero"],"contexts":["pos-layby"],"contextSections":{"pos-layby":"Main operations"},"order":22,"summary":"Save a new layby with its actual partial deposit, check the unpaid balance, and review deposit takings. Later instalment collection against an existing layby is not available in POS.","lastReviewed":"2026-10-07","owner":"retail","quickSections":["Main operations","At a glance"]}
---
# Laybys at POS

Use Layby mode to record a new layby and the deposit actually received. Merchandise remains unfulfilled and the unpaid balance stays owing.

## Main operations

- Mark the current positive cart as a layby.
- Review the tax-inclusive layby total.
- Add only the deposit actually received; do not enter the unpaid balance as another payment.
- Save the transaction with active layby status.
- Review the deposit and balance owing on the receipt and in Reports.
- Include the deposit in the opening day's payment-method takings and End of Day expected amounts, not completed merchandise revenue.
- Recognise that later instalment collection is not available in the current POS workflow.

## At a glance

| Current behavior | Available? |
|---|---|
| Mark a cart as Layby | Yes |
| Save after payment lines cover the full displayed amount | Yes |
| Save with a positive deposit and an unpaid remaining balance | Yes |
| Collect later partial instalments against the layby in POS | No |
| Apply a loyalty reward | No |
| Use Layby in Training Mode | No |

## Before you begin

- [ ] Confirm the register is open and POS is online.
- [ ] Confirm the cart contains ordinary positive-quantity merchandise.
- [ ] Explain the store's layby terms to the customer.
- [ ] Confirm the deposit amount and the store's approved process for later payments and collection.

> **Important:** Record only money actually received. Saving a deposit does not provide a POS action for later instalments or collection. Follow the store's approved process for those steps; never create a second sale or a fictitious payment to cover the remaining balance.

## Step-by-step

1. Build and check the cart.
2. Open **More** and choose **Layby: Off** so it changes to **Layby: ON**.
3. Confirm the main checkout button now says **Layby**.
4. Choose the Layby button to open **Layby Deposit**.
5. Enter the deposit amount. For manual payment, charge the terminal separately and add only the approved amount. For integrated Card payment, enter the deposit amount before choosing **Pay via Terminal**.
6. Choose **Save Layby**.
7. Keep the receipt and transaction reference, checking **Layby deposit paid** and **Balance owing**.
8. After a successful save, the cart clears and returns to ordinary sale mode. Check Reports for the active layby and its deposit.
9. If saving fails, keep the payment window open and retry saving the recorded deposit. Do not charge the customer again.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Layby is unavailable | Training Mode is active | Leave Training Mode before handling a live layby |
| **Save Layby** is disabled | No positive deposit has been added, or payments exceed the total | Add only the actual positive deposit and check the remaining balance |
| A loyalty reward cannot be selected | Rewards are unavailable on layby carts | Remove the reward and follow the business's layby policy |
| Staff need to take a later instalment | The current POS workflow has no instalment collection action | Stop and follow the business's approved manual process; do not enter a second sale as the same layby |
| Deposit is missing from completed merchandise revenue | The layby remains active | Check the Card or Cash takings and the active transaction; a deposit is not a completed merchandise sale |
| Save fails after the terminal approves payment | The layby save could not be confirmed | Retry saving the same recorded deposit without charging again |

## Worked examples

### Save a real partial deposit

A customer pays $26 Card against a $129.95 item. Staff add one $26 payment and save the layby with $103.95 owing. Reports and End of Day include $26 in Card takings. The $129.95 item is not counted as completed merchandise revenue and stock is not removed by saving the deposit.

### Later instalments require the approved alternative

The customer returns to pay another $30. POS has no payment action against the existing layby. Staff retain the original reference and use the store's approved process rather than entering a second merchandise sale.
