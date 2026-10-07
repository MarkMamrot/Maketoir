---
{"id":"pos-laybys","title":"Laybys at POS","audiences":["pos","ims"],"capability":"pos","screen":"POS > More > Laybys","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-selling-payments-manager-approval","pos-reports-transactions","pos-settings-terminals-offline-recovery","pos-end-of-day-xero"],"contexts":["pos-layby","laybys"],"contextSections":{"pos-layby":"Main operations","laybys":"Main operations"},"order":22,"summary":"Reserve goods with an actual deposit, accept later instalments, collect fully paid goods, or cancel with a recorded refund and branch cancellation fee.","lastReviewed":"2026-10-07","owner":"retail","quickSections":["Main operations","At a glance"]}
---
# Laybys at POS

Use Layby mode for a new layby and **More > Laybys** for its later payments, collection or cancellation. Deposits reserve goods at the current branch without removing stock on hand.

## Main operations

- Link an active customer and mark a positive merchandise cart as a layby.
- Save only money actually received, never the unpaid balance.
- Use **More > Laybys** to find the original customer or layby reference and add instalments.
- Final payment defaults to collection; clear **Collect when fully paid** to keep goods reserved for later collection.
- Use **Collect** only when the balance is fully paid.
- Cancel uncollected goods with the exact refund due and release their reservation.
- Set the branch cancellation percentage in **IMS > Settings > Point of Sale > Orders**. New laybys retain the rate agreed when opened; the default is 0%.
- Retry a saved deposit or action after a lost response without charging or refunding again.

## At a glance

| Current behavior | Available? |
|---|---|
| Save a positive partial deposit | Yes; cash/card only, online with an open register |
| Reserve stock | At opening; stock on hand changes only on collection |
| Later partial instalments | Yes; on the original layby at its branch |
| Fully paid, collect later | Yes; reservation remains in place |
| Cancellation fee | Branch percentage of the tax-inclusive merchandise total, capped at payments received |
| Staff fee override | Allowed with a reason when it differs from the agreed fee |
| Loyalty | No reward redemption on layby carts; eligible earning occurs once on collection |
| Training Mode | Laybys are unavailable |

## Before you begin

- [ ] Confirm the register is open and POS is online.
- [ ] Link an active customer and confirm positive merchandise quantities with sufficient available branch stock.
- [ ] Explain the store's layby terms to the customer.
- [ ] Confirm the deposit and branch cancellation terms.

> **Important:** For a configured, paired Zeller method, **Refund via Terminal** issues a card-present refund and requires terminal approval before recording cancellation. The customer must present their card, and the merchant's terminal refund policy still applies. **Use manual entry instead** records a refund issued separately; it does not return money automatically. Never charge or refund again merely because a save response was lost.

## Step-by-step

1. Build and check the cart, link the customer and confirm the branch terms.
2. Open **More** and choose **Layby: Off** so it changes to **Layby: ON**.
3. Confirm the main checkout button now says **Layby**.
4. Choose the Layby button to open **Layby Deposit**.
5. Enter the deposit amount. For manual payment, charge the terminal separately and add only the approved amount. For integrated Card payment, enter the deposit amount before choosing **Pay via Terminal**.
6. Choose **Save Layby**.
7. Keep the receipt and reference, checking the amount paid and balance owing. Printed and emailed receipts show the payment balance; cancelled receipts show the refund and retained fee. A fully paid opening layby is collected by default unless the collection checkbox was cleared.
8. After a successful save, the cart clears and returns to ordinary sale mode. Check Reports for the active layby and its deposit.
9. For later instalments, open **More > Laybys**, find the original reference and select **Add payment**. Record the actual instalment only.
10. For final payment, leave collection selected if goods are being handed over. Otherwise clear it, then use **Collect** when the customer returns.
11. To cancel before collection, select **Cancel layby**, check the retained fee, enter a reason for any override and choose **Refund and cancel**. Select Cash, a configured integrated Card method, or another supported manual tender and refund exactly the amount due. Complete cash/manual refunds separately before recording them. An integrated card refund must be approved on the terminal. If nothing is refundable, confirm cancellation directly.
12. If a save fails, use **Retry saved deposit** or **Retry saved action** in Laybys. These reuse the recorded request without another payment. A request tied to a register session that has since closed needs staff reconciliation rather than a new charge.

If the terminal outcome is unconfirmed, check terminal history before proceeding. An approved refund can be recorded using manual entry without issuing it again. Do not restart the refund merely because the browser lost the terminal response.

## Accounting and older laybys

Each deposit, instalment and refund contributes to its own payment day's takings and register session. Partial deposits are a liability, not merchandise revenue. GST is recognised on final payment, even when collection is later. Merchandise revenue is recognised on collection, without charging GST twice. Retained cancellation fees are revenue with GST extracted from the fee.

When Xero posting is enabled, an Admin must map **Layby Deposits** to a liability account, branch revenue to an income account, and each payment method to its branch clearing account, with clearing payments enabled. Accounting events post through End of Day and its retry. Laybys shows Pending, Posted or Posting failed separately from payment and collection status.

Older active laybys show **Reservation required**. Use **Reserve** before accepting an instalment. If the original deposit already has a Xero sales posting, stop for bookkeeper reconciliation; the reservation action does not silently reverse historical accounting. Collected goods use a normal linked return, not layby cancellation. Layby payment history cannot be replaced by generic payment-split or transaction edits.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Layby is unavailable | Training Mode is active | Leave Training Mode before handling a live layby |
| **Save Layby** is disabled | No positive deposit has been added, or payments exceed the total | Add only the actual positive deposit and check the remaining balance |
| A loyalty reward cannot be selected | Rewards are unavailable on layby carts | Remove the reward and follow the business's layby policy |
| Staff need to take a later instalment | The customer has returned to pay | Use **More > Laybys > Add payment** on the original reference |
| Deposit is missing from completed merchandise revenue | The layby remains active | Check the Card or Cash takings and the active transaction; a deposit is not a completed merchandise sale |
| Save fails after the terminal approves payment | The save could not be confirmed | Retry the saved request without charging again |
| Collection fails | The balance is unpaid or reserved branch stock is inconsistent | Settle the balance or resolve the stock discrepancy; do not force a generic status change |
| Accounting remains pending | End of Day or an earlier register posting is incomplete | Complete counts, check mappings and retry the original EOD |

## Worked examples

### Save a real partial deposit

A customer pays $26 Card against a $129.95 item. Staff add one $26 payment and save the layby with $103.95 owing. Reports and End of Day include $26 in Card takings. The $129.95 item is not counted as completed merchandise revenue and stock is not removed by saving the deposit.

### Instalments, final GST and collection

After the $26 deposit, the customer pays $30 on another visit, leaving $73.95 owing. That day's Card takings include only $30. The final $73.95 settles the balance and recognises $11.81 GST. If collection is deferred, stock remains reserved and merchandise revenue remains unrecognised. Collection later recognises $118.14 GST-exclusive revenue and removes the reserved item from stock on hand without another payment.

### Cancellation fee and refund

A $129.95 layby has $26 paid and an agreed 10% cancellation fee. The rounded fee is $13.00 and the refund is $13.00. A staff override to $5 needs a reason and makes the refund $21. If only $5 had been paid, the default fee would be capped at $5, leaving no refund. With the default 0% branch rate, all payments are refunded.
