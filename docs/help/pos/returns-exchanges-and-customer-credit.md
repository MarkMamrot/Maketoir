---
{"id":"pos-returns-exchanges-customer-credit","title":"Returns, Exchanges, and Customer Credit","audiences":["pos","ims"],"capability":"pos","screen":"POS Reports > Return","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-selling-payments-manager-approval","pos-end-of-day-xero","ims-customer-orders"],"contexts":["reports","pos"],"order":20,"summary":"Return eligible items from an original POS sale and choose a refund, gift card, or customer store credit.","lastReviewed":"2026-08-23","owner":"retail"}
---
# Returns, Exchanges, and Customer Credit

Use a linked return from POS Reports so the original quantities, refund value, stock movement, and customer credit record stay connected.

## Main operations

- Find the completed original sale in **Reports**.
- Start **Return** and choose only the eligible quantity being returned.
- Add replacement goods to make an exchange when appropriate.
- Refund to cash or card, issue a gift card, or issue store credit to a linked customer.
- Let the completed linked customer credit note add returned stock back once.

## At a glance

| Customer outcome | What POS records | Customer required? | Store-credit balance changes? |
|---|---|---|---|
| Cash or card refund | Negative payment plus a completed linked credit note | No | No |
| Gift Card (Issue) | A new or supplied gift-card code plus a completed linked credit note | No | No |
| Store Credit (Issue) | A completed linked credit note settled to store credit | Yes | Yes, credit is added once |
| Exchange | A linked return followed by a separate sale for the replacement goods | Depends on the return settlement | Only when Store Credit (Issue) is selected |

## Before you begin

- [ ] Use the original completed sale, not a new unlinked negative cart.
- [ ] Confirm how many units remain eligible to return.
- [ ] Inspect the physical goods and follow the retailer's return policy.
- [ ] Confirm the customer wants a refund, gift card, store credit, or exchange.
- [ ] Connect to the internet; linked returns cannot complete offline.

> **Important:** Every completed POS return creates and completes a linked customer credit note. That linked credit note adds returned stock back once. Do not also create a manual stock adjustment or a second credit note for the same goods.

## Step-by-step

1. Open **Reports**, choose the date, and find the original completed sale.
2. Select **Return**. POS loads the original eligible lines into a linked return cart.
3. Set each returned line to the physical quantity received. POS prevents returning more than the remaining eligible quantity.
4. For an exchange, complete the linked return first, then start a separate sale for the replacement merchandise.
5. Link the customer before choosing **Store Credit (Issue)**.
6. Select **Refund**, choose the agreed settlement method, and complete the transaction online.
7. Confirm the return appears in Reports and retain the receipt or new gift-card code as required.

## Refund decision guide

| Choose | Use when | Important distinction |
|---|---|---|
| Cash or Card | Money is being returned through that tender | This does not create customer store credit |
| Gift Card (Issue) | The customer receives transferable value represented by a code | Gift-card value is redeemed by code, not by linking a customer account |
| Store Credit (Issue) | The named customer receives account-bound credit | A customer must be linked; the credit note updates that customer's balance |
| Exchange | Returned goods are processed first and replacement goods are sold separately | Compare the return value with the new sale so the customer understands the net difference |

Gift cards and store credit are not interchangeable. A gift card is code-based value. Store credit belongs to a linked customer and should only be issued through the completed credit-note flow.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Return says internet is required | POS cannot validate and complete the linked return offline | Reconnect and restart from the original sale |
| No items are available to return | Every original unit has already been returned | Review prior returns; do not create another return |
| Store Credit (Issue) is unavailable | No customer is linked | Search for and link the correct customer before payment |
| The refund amount is unexpected | The original sale included discounts or prior returns | Review the loaded linked lines and remaining eligible quantities |
| Stock appears to have increased twice | A manual correction may duplicate the linked credit note | Stop and review the POS return and its linked credit note before changing stock |

## Worked examples

### Return one discounted shirt to store credit

The original sale contains two shirts, and the returned shirt's share of the paid total is $54.00 including GST. Staff start **Return** from that sale, leave one shirt at quantity `-1`, link Priya's customer account, and choose **Store Credit (Issue)** for $54.00. POS completes the return, the linked credit note adds one shirt back to stock, and Priya receives $54.00 store credit once.

### Exchange for a higher-priced item

A customer returns a $70.00 item and chooses a $95.00 replacement. Staff complete the linked $70.00 return using the agreed settlement, then ring up the replacement as a separate $95.00 sale. The two receipts show a net $25.00 difference without mixing the stock movements.

## Related tasks

See **Selling, Payments, and Manager Approval** for tender entry and **End of Day and Xero** for how return payments affect the counted day.