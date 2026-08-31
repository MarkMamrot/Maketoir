---
{"id":"pos-end-of-day-xero","title":"End of Day and Xero","audiences":["pos","ims"],"capability":"pos","screen":"POS > Register > End of Day","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-register-device-login","pos-selling-payments-manager-approval","pos-reports-transactions","pos-petty-cash","pos-settings-terminals-offline-recovery","ims-xero-shopify"],"contexts":["eod","pos-eod","pos-reports","xero-pos-eod"],"contextSections":{"eod":"Step-by-step","pos-eod":"Step-by-step","pos-reports":"Till variance and cash activity","xero-pos-eod":"What Xero receives"},"order":60,"summary":"Count and close a register, explain variances, and understand the separate Xero posting result.","lastReviewed":"2026-08-31","owner":"retail"}
---
# End of Day and Xero

Use End of Day to compare physical takings with recorded sales, close the register session, and start the configured Xero posting.

## Main operations

- Count every payment method for the open register session.
- Separate the cash opening float from cash sales.
- Review and confirm any till variance before saving.
- Close the register even when a separate Xero action needs repair.
- Review Xero Sync History and retry only the unfinished accounting action.

## At a glance

| Value | How Solvantis treats it |
|---|---|
| Expected | Completed sales linked to this register session, grouped by payment method |
| Counted cash | All physical cash in the drawer, including the opening float |
| Cash sales | Counted cash minus opening float |
| Counted non-cash | The counted amount for that payment method |
| Variance | Cash sales or counted non-cash minus the expected amount |
| Petty cash | A separately recorded purchase paid from the open till |

## Before you begin

- [ ] Confirm you are closing the correct branch and register.
- [ ] Allow queued sales to sync so they can be linked to the register session.
- [ ] Count the drawer and each non-cash settlement source independently.
- [ ] Keep petty-cash receipts with the corresponding entries.
- [ ] Add useful notes for any confirmed difference.

> **Warning:** End of Day cannot be saved offline. If saving fails because the connection is down, the register remains open; reconnect and complete the count again.

## Step-by-step

1. Open **Register**, then select **End of Day**.
2. Check the trading date and the expected amount for each payment method.
3. For cash, enter the opening float and count the full drawer. The screen calculates cash sales as counted cash minus the float.
4. Enter the counted total for each other payment method.
5. Review the variance column. If a variance exists, recheck the count and add a note where useful.
6. Select the save action. Confirm the variance warning if the difference is genuine.
7. Print or retain the reconciliation summary as required by the business.
8. Confirm the register is closed. The configured Xero sync starts in the background when at least one counted amount was saved.

## Till variance and cash activity

| Situation | Expected result | What to check |
|---|---|---|
| Counted cash equals float plus recorded cash sales | Zero cash variance | No correction is needed |
| Counted cash is higher | Positive variance | Recount, check change and tender selection, then record a note |
| Counted cash is lower | Negative variance | Recount, check refunds and petty cash, then record a note |
| Petty cash was recorded | Cash left the drawer for a documented purchase | Confirm the amount, reason, GST treatment, expense category, and receipt |
| Sales were queued without an open session | Expected totals can be incomplete until those sales sync | Reconnect, open the register when prompted, sync, and review before closing |

## What Xero receives

POS sales are not posted one by one at checkout. For each counted payment method, the configured EOD process can create one Authorised sales invoice using the mapped location revenue account. If clearing payments are enabled, it then applies the invoice payment to that method's mapped clearing account.

The invoice is tax-inclusive, so Xero extracts GST from the total instead of adding GST. Cash rounding, till variance, and petty cash are handled separately using their configured mappings.

| Xero result | Register result | Next action |
|---|---|---|
| Invoice and payment complete | Closed | No action |
| Invoice complete, payment failed | Closed | Repair the clearing mapping or connection, then retry |
| Posting blocked by a missing mapping | Closed | Ask an Admin to complete the mapping, then retry |
| POS batch posting disabled or invoice-only | Closed | Follow the business's accounting policy; do not recreate sales |

> **Important:** Register closure and Xero posting are separate outcomes. A Xero failure does not reopen the register, and retrying should continue the unfinished accounting work rather than create another day of sales.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Counted cash appears too high | Opening float was not subtracted, petty cash was missed, or a sale used the wrong tender | Recount and compare the float, petty-cash entries, and transaction payments |
| Expected totals omit recent sales | Sales are still queued or were uploaded without an open register session | Resolve the queue and review Reports before finalising the variance |
| One payment method does not post to Xero | Its clearing mapping is missing or stale | Correct the mapping and retry that EOD posting |
| Invoice exists but its payment does not | The clearing step failed after invoice creation | Retry; Solvantis reuses the recorded invoice rather than intentionally creating another |
| EOD saved but Xero shows an error | Operational close succeeded before accounting finished | Leave the register closed and repair the accounting action separately |

## Worked examples

### Cash count with float and petty cash

The drawer opens with $200. Recorded cash sales are $640, and a $22 GST-inclusive cleaning purchase was recorded through **Petty Cash**. Staff count $818 in the drawer. Cash sales from the count are $818 minus $200, or $618; the separate $22 petty-cash record explains the difference from $640 before any unexplained till variance is considered.

### Card invoice awaiting payment

The counted card total is $1,100. Solvantis creates the tax-inclusive Authorised sales invoice, but the clearing payment fails. The register remains closed. After an Admin repairs the card clearing mapping, staff retry the unfinished sync instead of entering the $1,100 again.

## Related tasks

See **Register, Device, and Login** for opening float, **Selling, Payments, and Manager Approval** for tender handling, and **Settings, Terminals, and Offline Recovery** for queued-sale recovery.