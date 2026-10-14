---
{"id":"pos-end-of-day-xero","title":"POS End of Day and Xero","audiences":["pos","ims"],"capability":"pos","requiresCapabilities":["xero"],"screen":"POS > Register > End of Day accounting","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-end-of-day","pos-laybys","pos-petty-cash","ims-xero-shopify"],"contexts":["xero-pos-eod","pos-eod-accounting"],"contextSections":{"xero-pos-eod":"What Xero receives","pos-eod-accounting":"Step-by-step"},"order":60,"summary":"Understand optional POS End of Day invoices, clearing payments and layby accounting, and retry unfinished Xero posting without duplicating sales.","lastReviewed":"2026-10-14","owner":"retail","quickSections":["Main operations","At a glance"],"navigation":{"category":"pos","label":"Review EOD accounting and retry Xero posting","subgroup":"Start & end of day","sections":[{"heading":"What Xero receives","label":"Understand EOD invoices and layby accounting"},{"heading":"Step-by-step","label":"Review or retry EOD accounting"}]}}
---
# POS End of Day and Xero

This guide covers optional Xero posting after counted End of Day reconciliation. Use **End of Day and Register Close** for the cash count, variance review, saved reconciliation and register closure; those operations do not require Xero.

## Main operations

- Complete and verify the operational reconciliation first.
- Review Xero posting separately from register closure.
- Check each payment method's invoice and clearing-payment result.
- Treat layby cash flows separately from completed-sale revenue.
- Ask an Admin to repair missing mappings or connection problems.
- Retry only unfinished accounting work; do not recreate sales or take payments again.

## At a glance

| Value | How Solvantis treats it |
|---|---|
| Counted EOD save | Can start configured Xero posting in the background |
| Register closed | Operational closure, not proof that Xero posting completed |
| Invoice posted | The sales invoice exists; a required clearing payment may still be unfinished |
| Paid in Xero | The reported invoice/payment result is complete |
| Layby cash flow | Separate liability and clearing-account treatment, not ordinary sales-invoice revenue |
| Missing mapping | Posting is blocked until the required configuration is repaired |

## Before you begin

- [ ] Verify counted reconciliation for the correct branch, register and session.
- [ ] Confirm the business's Xero posting policy and connection.
- [ ] Check branch revenue and payment-method clearing mappings with an Admin.
- [ ] Keep petty-cash evidence and explanations for confirmed variances.
- [ ] For laybys, confirm liability and clearing mappings and finish earlier accounting first.

> **Important:** A saved reconciliation, a closed register and a successful Xero post are three separate checks. Do not repeat the operational close just because accounting failed.

## Step-by-step

1. Complete **End of Day and Register Close** and verify the saved counts and register status.
2. Review the Xero summary for the same session. Counted EOD saving can start the configured sync in the background; sales are not posted individually at checkout.
3. Check every method's result. **Invoice posted** or **Invoice posted - payment pending** is not the same as a completed required clearing payment.
4. If a mapping or connection blocks posting, ask an Admin to repair that configuration before retrying.
5. Use **Sync to Xero** when unfinished work needs retrying. If the screen offers **Re-sync to Xero**, check the recorded result before using it rather than assuming another invoice is required.
6. Check the final invoice/payment result and Xero Sync History. Leave an already closed register closed and do not recreate the day's sales.

The Assistant's register-status check can verify expected takings and saved-count status. That saved-count indicator is not evidence that Xero posting succeeded.

## Till variance and cash activity

| Situation | Expected result | What to check |
|---|---|---|
| Confirmed till variance | Separate treatment using the configured variance mapping | The saved physical count and explanation |
| Petty cash was recorded | Separate expense treatment rather than ordinary sales revenue | Amount, reason, GST treatment, expense category and receipt |
| Cash differs from Expected | Operational reconciliation needs review before explaining accounting | Use End of Day and Register Close; do not alter counts just to match Xero |
| Layby money was received or refunded | Liability and clearing treatment outside ordinary sales invoices | Recorded layby events and required mappings |

## What Xero receives

POS sales are not posted one by one at checkout. For each counted payment method, the configured EOD process can create one Authorised sales invoice using the mapped location revenue account. If clearing payments are enabled, it then applies the invoice payment to that method's mapped clearing account.

Layby cash flows are excluded from those sales invoices. Their receipts and refunds post to the mapped **Layby Deposits** liability and branch clearing accounts. Final payment recognises GST; collection releases the GST-exclusive liability to branch revenue. A fully paid cancellation reverses its final-payment GST before any retained taxable fee is posted. Deposit-only and refund-only days still have layby accounting to post.

Layby posting needs a liability mapping, branch revenue and every payment method's clearing account, with POS clearing payments enabled. Missing mappings block posting rather than treating deposits as sales. Finish earlier layby EOD accounting before later events. Retry reuses event references and reconciles an existing Xero document after an uncertain response. It does not change historical sales invoices automatically.

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
| One payment method does not post to Xero | Its clearing mapping is missing or stale | Correct the mapping and retry that EOD posting |
| Invoice exists but its payment does not | The clearing step failed after invoice creation | Retry; Solvantis reuses the recorded invoice rather than intentionally creating another |
| EOD saved but Xero shows an error | Operational close succeeded before accounting finished | Leave the register closed and repair the accounting action separately |

## Worked examples

### Separate register closure from posting

Staff save verified counts and confirm that the register is closed. A missing revenue mapping blocks Xero posting. An Admin repairs the mapping, then staff retry the unfinished posting. They do not reopen the register or enter the day's sales again.

### Card invoice awaiting payment

The counted card total is $1,100. Solvantis creates the tax-inclusive Authorised sales invoice, but the clearing payment fails. The register remains closed. After an Admin repairs the card clearing mapping, staff retry the unfinished sync instead of entering the $1,100 again.

## Related tasks

See **End of Day and Register Close** for operational reconciliation, **Laybys at POS** for the layby lifecycle, and **Petty Cash at POS** for till expenses.