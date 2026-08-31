---
{"id":"pos-store-credit","title":"Store Credit at POS","audiences":["pos","ims"],"capability":"pos","screen":"POS Checkout > Customer Store Credit","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-customers","pos-selling-payments-manager-approval","pos-returns-exchanges-customer-credit","pos-gift-cards"],"contexts":["pos-store-credit"],"contextSections":{"pos-store-credit":"Step-by-step"},"order":18,"summary":"Confirm a linked customer's available store credit and apply it safely to a POS sale.","lastReviewed":"2026-08-31","owner":"retail"}
---
# Store Credit at POS

Store credit belongs to a named customer. Link that customer before applying any of their available balance to a sale.

## Main operations

- Find and link the customer who owns the credit.
- Confirm the balance displayed beside the linked customer.
- Apply up to the available credit or amount remaining.
- Add another tender when credit does not cover the sale.
- Issue new store credit only through a completed linked return.

## At a glance

| Situation | POS behavior |
|---|---|
| No customer linked | Store Credit does not appear as a payment method |
| Linked balance is zero | Store Credit does not appear as a payment method |
| Credit exceeds amount due | POS applies no more than the amount remaining |
| Credit is less than amount due | Add the available credit, then another tender |
| Customer wants new credit for returned goods | Start a linked return and choose **Store Credit (Issue)** |
| Training Mode or offline validation | Live store-credit use is unavailable |

## Before you begin

- [ ] Confirm POS is online.
- [ ] Link the correct named customer.
- [ ] Confirm the balance shown belongs to that customer.
- [ ] Keep issuance and redemption distinct.

> **Warning:** Do not use another customer's account or manually recreate credit. New store credit must come from the completed linked return that records the returned value once.

## Step-by-step

1. Open **Customer** and link the customer who owns the credit.
2. Confirm the available store-credit amount displayed beside their name.
3. Build the sale and choose **Charge**.
4. Select **Store Credit**.
5. Confirm the customer name and available balance shown in the payment window.
6. Enter the amount to use and choose **Add**. POS limits the contribution to the available balance and the sale amount remaining.
7. If a balance remains, add cash, card, or another permitted tender.
8. Complete the sale only when **Remaining** is zero.

To add new store credit after returned goods, open the original sale in **Reports**, start **Return**, link the customer, and choose **Store Credit (Issue)**. The completed linked return records the stock and customer credit together.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Store Credit is missing | No eligible linked customer or the balance is zero | Verify the customer and displayed balance |
| The expected balance is not shown | The wrong customer is linked or current value cannot be loaded | Remove the customer, search again, and retry online |
| Credit will not cover the full sale | The available balance is lower than the amount due | Apply the available credit and add another tender |
| Staff need to add credit manually | The customer is returning goods | Use the linked return and **Store Credit (Issue)** workflow instead |
| Credit use is unavailable | POS is offline or Training Mode is active | Reconnect or leave Training Mode before using live customer value |

## Worked examples

### Use credit with a second tender

Morgan has $32 store credit and buys $50 of merchandise. Staff link Morgan, apply $32 by Store Credit, and add $18 by Card. The receipt records both tenders and the sale completes with no remaining balance.
