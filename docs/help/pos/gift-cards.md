---
{"id":"pos-gift-cards","title":"Gift Cards at POS","audiences":["pos","ims"],"capability":"pos","screen":"POS Checkout > Gift Card","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-selling-payments-manager-approval","pos-returns-exchanges-customer-credit","pos-store-credit"],"contexts":["pos-gift-cards"],"contextSections":{"pos-gift-cards":"Step-by-step"},"order":16,"summary":"Sell a gift card, verify its code and balance, or redeem it as part or all of a POS payment.","lastReviewed":"2026-08-31","owner":"retail"}
---
# Gift Cards at POS

Gift cards are code-based value. Sell a new card from the cart or verify an existing card before using it as payment.

## Main operations

- Add a new gift card with a chosen value to the cart.
- Supply a card code or let POS generate one.
- Verify an existing card and view its current balance.
- Redeem no more than the card balance or amount remaining.
- Combine gift-card value with another payment when needed.
- Issue a gift card while completing an eligible linked return.
- Review a card's Balance History in IMS using the business timezone configured in IMS Settings.

## At a glance

| Action | Customer link required? | What identifies the value? |
|---|---|---|
| Sell a new gift card | No | The supplied or generated card code |
| Redeem a gift card | No | A verified existing card code |
| Split gift card plus another tender | No | Gift-card code plus the second payment line |
| Issue value from a return | No | The new or supplied code on the linked return |
| Use in Training Mode | Not available | Training sales cannot change gift-card value |

Balance History timestamps reflect the business timezone, regardless of the timezone configured on the device viewing IMS.

## Before you begin

- [ ] Confirm POS is online.
- [ ] Confirm the sale or return amount.
- [ ] Read or scan the exact card code where one already exists.
- [ ] Keep the code private from unrelated customers.

> **Important:** Do not accept a gift card until POS verifies its current balance. A printed or displayed code is not proof that value remains available.

## Step-by-step

### Sell a new gift card

1. Choose **Gift Card** beside **Clear Cart**.
2. Enter the amount to load.
3. Enter the card code when using a prepared physical card, or leave it blank for POS to generate a code.
4. Choose **Add to Cart**.
5. Check the gift-card line and complete payment for the sale.
6. Give the customer the receipt and card code according to store procedure.

### Redeem a gift card

1. Build the cart and choose **Charge**.
2. Select **Gift Card**.
3. Enter the card code and choose **Verify**.
4. Confirm the displayed balance.
5. Enter the amount to use and choose **Add**. POS caps it at both the card balance and the amount remaining.
6. Add another payment method if a balance remains, then complete the sale.

For a return, start from the original transaction in **Reports**. Choose **Gift Card (Issue)** only as settlement for that linked return.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Card cannot be verified | The code is wrong, inactive, exhausted, or POS is offline | Re-enter the complete code and confirm the connection |
| **Add** is disabled | The card has not been verified | Choose **Verify** and wait for its balance |
| Gift card covers only part of the sale | Its balance is lower than the amount due | Add the available amount, then use another tender |
| New card was added with the wrong value | The cart has not yet been completed | Remove the gift-card line and add it again with the correct value |
| Gift Card is unavailable | Training Mode is on | Leave Training Mode before processing live gift-card value |

## Worked examples

### Split a sale after verification

A verified card has $50 available and the sale total is $79.95. Staff add $50 as Gift Card, then add $29.95 by Card. POS completes only when the payment lines cover the full $79.95.
