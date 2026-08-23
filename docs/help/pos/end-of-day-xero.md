---
{"id":"pos-end-of-day-xero","title":"End of Day and Xero","audiences":["pos","ims"],"capability":"pos","screen":"POS > End of Day","product":"pos","parentId":"pos-end-of-day","contexts":["eod","pos-eod","pos-reports","xero-pos-eod"],"order":90,"summary":"Close a counted register session and understand when POS sales post to Xero.","lastReviewed":"2026-08-23","owner":"retail"}
---
# End of Day and Xero

POS sales are not sent to Xero individually at checkout. When staff close End of Day with at least one counted payment amount, Solvantis automatically starts the configured POS EOD Xero sync in the background.

## Main operations

- Count each payment method and save the End of Day reconciliation.
- Closing a counted EOD starts the Xero sync; register closure does not wait for Xero to finish.
- Solvantis processes each counted payment method and creates its configured Authorised sales invoice.
- When clearing payments are enabled, Solvantis applies the invoice payment to the mapped clearing account.
- Review Xero Sync History or use the available retry action when an invoice or payment remains unfinished.

## Before you begin

The register session should be open for the correct location and the physical payment totals should be counted. Xero posting depends on the business Xero connection, POS batch policy, location revenue mapping, and payment-method clearing mappings. Missing Xero configuration does not prevent the register from closing.

## Step-by-step workflows

### Close the register

1. Open **End of Day** from POS.
2. Review expected totals and enter the counted amount for each payment method.
3. Record the cash opening float and denomination count where applicable.
4. Save and close the reconciliation.
5. Solvantis starts the configured Xero posting in the background for the counted methods.

### Review or retry Xero posting

1. Review the EOD result and Xero Sync History from IMS when an accounting action is incomplete.
2. Correct missing or stale revenue and clearing mappings before retrying.
3. Retry the unfinished EOD sync. Existing invoice and payment identifiers are reused so a retry does not intentionally create another invoice.

## Statuses, calculations, and permissions

POS prices and totals are tax-inclusive. The Xero EOD invoice uses inclusive tax treatment so Xero extracts GST rather than adding GST on top. Posting policy can disable all POS batch posting or allow invoice creation without clearing payments.

For cash, Solvantis separates the opening float from sales and can account for cash rounding, till variance, and petty cash using the configured mappings. Non-cash methods use their counted EOD amount and mapped clearing account.

## Troubleshooting

- **Nothing posted:** Check that at least one counted amount was saved, POS batch posting is enabled, Xero is connected, and the location has a revenue mapping.
- **One payment method did not post:** Check that method's clearing mapping. Other correctly mapped methods can still post.
- **Invoice posted but payment failed:** Retry the EOD sync. Solvantis retains the existing invoice and retries the unfinished payment.
- **Register closed while Xero failed:** This is expected separation. Register closure remains valid; repair and retry the accounting action without reopening or repeating sales.

## Related tasks

Related Help topics include Opening a Register, POS Payments, Returns, Cash Banking, Xero Ledger Mapping, and Xero Sync History.

## Worked examples

### Normal card EOD

A counted card total of $1,100 is saved at register close. Solvantis starts EOD sync, creates the configured tax-inclusive Authorised sales invoice for that payment method, and applies $1,100 to its mapped clearing account when payment sync is enabled.

### Missing card clearing account

Cash and card are counted, but card has no clearing mapping. The register still closes. Any correctly configured methods can post, while card remains blocked. After an Admin saves the mapping, retrying the EOD sync completes the unfinished card posting without entering the sales again.