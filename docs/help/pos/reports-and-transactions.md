---
{"id":"pos-reports-transactions","title":"POS Reports and Transactions","audiences":["pos","ims"],"capability":"pos","screen":"POS > Reports","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-returns-exchanges-customer-credit","pos-selling-payments-manager-approval","pos-end-of-day-xero"],"contexts":["reports"],"contextSections":{"reports":"Step-by-step"},"order":32,"summary":"Review location totals and transactions, reprint receipts, start returns, and perform permitted corrections.","lastReviewed":"2026-08-31","owner":"retail"}
---
# POS Reports and Transactions

Use Reports to review one trading date for the active POS location and open the transaction that owns any follow-up action.

## Main operations

- Select a date and review revenue, transaction count, and payment totals.
- Compare the selected day with the 30-day revenue chart.
- Expand a transaction to inspect items, payments, and order notes.
- Reprint a receipt or start a linked return.
- Reallocate a fixed sale total between payment methods.
- Use a manager PIN for current-register transaction edits or deletion.

## At a glance

| Action | What it changes | Manager PIN? |
|---|---|---|
| Expand transaction | Nothing; displays lines, payments, and notes | No |
| Print | Recreates the receipt view | No |
| Return | Starts an eligible return from the original completed sale | No universal PIN prompt |
| Edit payment split | Reallocates the existing fixed total between methods | No |
| Edit current-register transaction | Protected sale details | Yes |
| Delete current-register transaction | Voids the transaction | Yes |

## Before you begin

- [ ] Confirm the POS device is assigned to the location being reviewed.
- [ ] Choose the correct trading date.
- [ ] Locate the original transaction before entering any correction.
- [ ] Have the authorised location manager available for protected actions.

> **Warning:** Do not delete a transaction merely to correct its payment mix. Use **Edit payment split** when the sale total and merchandise are already correct.

## Step-by-step

1. Open **More > Reports**.
2. Choose the required date. Reports loads that date for the active POS location.
3. Review **Total Revenue**, **Transactions**, and the payment-method totals.
4. Select a transaction row to expand its products, payment lines, and order notes.
5. Choose **Print** to recreate its receipt.
6. Choose **Return** on an eligible completed sale to start a linked return with the original quantities and values.
7. Choose **Edit** to change only the payment allocation. Ensure the new lines still total the fixed sale amount.
8. For an eligible transaction from the current open register session, choose **Transaction** or **Delete** and ask the authorised manager to enter their PIN.
9. Reload or reselect the date after a correction and confirm the expected totals.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| No transactions appear | The wrong date or location is selected, or the sale is still queued | Check the header and date; reconnect and sync queued sales |
| Return is not shown | The record is not an eligible completed sale | Confirm status and use the owning correction workflow |
| Transaction edit/delete is missing | The sale is outside the current open register session | Do not bypass the boundary; review it through the appropriate back-office workflow |
| Payment split cannot save | Lines do not equal the fixed transaction total | Correct methods and amounts until the remaining difference is zero |
| Receipt has unexpected location details | The device or receipt settings are assigned differently | Confirm the active location and ask an authorised user to review receipt settings |

## Worked examples

### Correct the payment mix without changing the sale

A $120 sale was recorded entirely as Card, but the customer paid $20 Cash and $100 Card. Staff open the transaction, choose **Edit**, replace the payment lines with $20 Cash and $100 Card, and save. The products and $120 sale total remain unchanged.
