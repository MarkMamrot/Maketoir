---
{"id":"ims-xero-reconciliation","title":"Xero Sync and Reconciliation","audiences":["ims"],"capability":"integrations","screen":"Integrations > Xero","product":"ims","format":"task","parentId":"ims-xero-shopify","contexts":["xero"],"contextSections":{"xero":"Step-by-step"},"relatedTopics":["ims-xero-shopify","ims-operational-reports","ims-customer-orders"],"order":91,"summary":"Configure Xero posting, distinguish IMS success from accounting failure, and retry safely.","lastReviewed":"2026-08-27","owner":"integrations"}
---
# Xero Sync and Reconciliation

Use Xero setup and activity views to configure supported accounting work, investigate failures, and retry without repeating successful IMS operations.

## Main operations

- Maintain sync rules, account and tracking mappings, and payment routing.
- Review Sync History for pending, successful, blocked, partial, or dismissed work.
- Use COGS Reconciliation to investigate cost posting coverage.
- Review and post balanced Shopify payout plans when enabled.
- Retry only the accounting action that remains unfinished.

## At a glance

| Area | Use it for | Typical question |
|---|---|---|
| Sync Rules | Choose which supported workflows create Xero documents and when | Should this workflow post automatically? |
| Accounts & Tracking | Map IMS activity to Xero accounts and reporting dimensions | Which account or branch option should this use? |
| Payment Methods | Route tender and gateway settlement | Where should this payment clear? |
| Sync History | Inspect and retry accounting work | Did Xero accept this source? |
| COGS Reconciliation | Compare eligible source cost with Xero journals | Is cost of goods sold fully posted? |
| Shopify Payouts | Plan and post balanced payout settlement | Do sales, fees, refunds, and payout total balance? |

## Before you begin

- [ ] Confirm Xero is connected and authorized.
- [ ] Identify the exact IMS source and whether its operational action already succeeded.
- [ ] Read the safe error shown in Sync History.
- [ ] Check the required account, tax, tracking, and payment mappings.
- [ ] Confirm whether the workflow is manual or automatic under Sync Rules.

> **Warning:** A completed IMS sale, receipt, fulfilment, return, or credit stays completed when its Xero posting fails. Do not repeat the IMS action to make Xero retry.

## Step-by-step

### Configure a posting path

1. Open **Xero > Setup > Sync Rules** and enable only the supported workflows your business intends to post.
2. Open **Accounts & Tracking** and map the required sales, purchasing, inventory, cost, tax, and branch or channel choices.
3. Open **Payment Methods** and map each enabled tender or gateway to the appropriate Xero account.
4. Under **POS Clearing Accounts**, optionally configure processing fees for each location and payment method:
	- Choose the fee expense account and whether the fee is **GST on Expenses** or **BAS Excluded**.
	- Enable calculated fees and enter the fixed amount per successful payment plus the percentage rate.
	- Calculated fees post from that row's clearing account after its EOD invoice payment succeeds.
5. Save the mappings and run a normal source workflow.
6. Open **Sync History** and confirm the resulting status before enabling broader automation.

### Recover a failed accounting action

1. Confirm the IMS source is complete and note its reference.
2. Open **Xero > Sync History** and find that reference.
3. Read the status and error detail.
4. Repair the named cause, such as expired authorization, missing account, payment route, tax choice, tracking option, or an unbalanced payout plan.
5. Choose the supported retry or replan action for that entry.
6. Refresh and confirm success in Sync History and Xero.
7. Reconcile the resulting Xero document to the original IMS source.

### Decide what to repeat

| IMS operation | Operational result | Xero result | Correct recovery |
|---|---|---|---|
| Purchase receipt completed | Stock increased once | Bill posting failed | Fix Xero setup and retry the bill posting |
| Sales Order fulfilled | Stock and order status changed once | Invoice action failed | Retry the invoice action only |
| Customer credit completed | Return and customer value recorded once | Credit posting failed | Retry the credit posting only |
| POS End of Day completed | Register day closed and summarized | Xero batch failed | Retry the EOD accounting entry |
| Shopify payout captured | Payout plan available | Posting blocked or partial | Fix the named plan item, then replan or post as offered |

> **Tip:** Tracking is optional for supported postings, but missing tracking means the result will not appear under that Xero reporting dimension. Missing a required account or payment route can block posting.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Many entries fail together | Connection expired or Xero unavailable | Reauthorize and retry affected entries |
| One source is blocked | A required mapping or source condition is missing | Correct the named item and retry that entry |
| COGS does not reconcile | Missing or incomplete historical cost coverage, or journal not posted | Review COGS Reconciliation and source movement cost |
| Shopify payout will not post | Invoice, credit, clearing account, fee account, tax, currency, or total does not balance | Fix the named difference and replan |
| Entry was dismissed | It was removed from the active queue, not synced | Find it in history and use the available manual retry if still required |

## Worked examples

### Operational success with accounting failure

Staff receive 10 units on a Purchase Order. Stock correctly rises by 10, but Xero rejects the bill because the purchasing account mapping is missing. Add the mapping and retry the Xero entry. Receiving another 10 would incorrectly double stock.

### Reconcile a Shopify payout

A paid payout contains sales, a refund, fees, and the net bank settlement. Review the payout plan, fix any blocked invoice, credit, account, tax, currency, or total mismatch, then replan. Post only when the package balances to the actual payout.

### Calculate a POS card fee

Newtown Card is configured for a $0.30 fixed fee and 1.75%. Two successful card payments total $110.00 during the register session. The EOD fee is $0.30 × 2 + $110.00 × 1.75% = $2.53. After the card clearing payment succeeds, Solvantis posts a $2.53 Spend Money transaction from Newtown's card clearing account to the selected fee expense account. A failed fee posting can be retried without repeating the invoice payment.
