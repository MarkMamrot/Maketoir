---
{"id":"ims-xero-reconciliation","title":"Xero Sync and Reconciliation","audiences":["ims"],"capability":"integrations","screen":"Finances > Xero Integration","product":"ims","format":"task","parentId":"ims-xero-shopify","contexts":["xero","settings-xero","activity-cogs"],"contextSections":{"xero":"Step-by-step","settings-xero":"Advisor access","activity-cogs":"Review and recover COGS postings"},"relatedTopics":["ims-xero-shopify","ims-operational-reports","ims-customer-orders","ims-purchase-orders"],"order":91,"summary":"Configure Xero posting, distinguish IMS success from accounting failure, and retry safely.","lastReviewed":"2026-10-09","owner":"integrations","quickSections":["Main operations","At a glance"]}
---
# Xero Sync and Reconciliation

Use Xero setup and activity views to configure supported accounting work, investigate failures, and retry without repeating successful IMS operations.

## Main operations

- Maintain sync rules, account and tracking mappings, and payment routing.
- For foreign order payments, verify the saved payment rate and AUD account mapping, then compare the posted bank amount; do not replay an already posted payment with an incorrect conversion.
- Review Sync History for pending, successful, blocked, partial, or dismissed work.
- Ask Assistant for a bounded local summary of queued documents and categorized recent failures.
- Use COGS Reconciliation to investigate cost posting coverage.
- Future COGS manual journals are requested as Posted and separate each location-accounting-channel amount into balanced COGS and Inventory Asset lines. Inspect the saved line-item snapshot and live Xero status under **Reports > Sales & COGS Traceability > Xero Postings**.
- **Approved zero cost** counts FIFO movements whose source layer has an explicit no-charge reason. They are valid $0 COGS; unexplained zero costs still block posting.
- Review and post balanced Shopify payout plans when enabled.
- Retry only the accounting action that remains unfinished.
- PO bill approval checks the live Xero status first. Already authorised or paid bills retain their status; syncing does not reopen a paid bill.
- Administrators can separately grant Advisor mapping access, read-only payout access, and permission to trigger Xero syncs from **Settings > Xero > Advisor Access**.

## Advisor access

**Allow Advisors to trigger Xero syncs** is off by default and can only be changed by an administrator. When enabled, Advisors can post or retry existing documents and payments, completed online-sales days, POS End of Day accounting, stocktake journals, COGS journals, existing payout plans, and confirmed cash deposits. Existing posting rules, completed-period checks, mapping requirements, and duplicate-posting protections still apply.

Sync access does not permit editing sales or inventory, completing operational records, issuing refunds, voiding documents, dismissing queued work, changing sync policies, renaming invoices, overriding valuation checks, or planning and repairing payouts. Account mapping access remains a separate permission.

Advisor online-sales sync uses the orders already saved in Solvantis and does not run a Shopify order import. Ask an authorised operator to refresh Shopify orders before syncing when the saved orders may be incomplete.

With sync access disabled, Advisors cannot trigger these posting or retry actions. Read-only payout access alone does not permit posting payouts.

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

- Enable **Accounting software** and choose **Xero** in **Settings > General > Business Operations**. When this operation is off, Xero navigation, setup, statuses, automation, Help guidance, and posting requests are unavailable.
- [ ] Confirm Xero is connected and authorized.
- [ ] Identify the exact IMS source and whether its operational action already succeeded.
- [ ] Read the safe error shown in Sync History.
- [ ] Check the required account, tax, tracking, and payment mappings.
- [ ] Confirm whether the workflow is manual or automatic under Sync Rules.
- [ ] For a bookkeeper Advisor, ask an administrator to enable **Advisor access to Shopify Payouts** under **Settings > Xero > Advisor Access**.

> **Warning:** A completed IMS sale, receipt, fulfilment, return, or credit stays completed when its Xero posting fails. Do not repeat the IMS action to make Xero retry.

### Ask Assistant about Xero sync health

Assistant can check whether the local Xero connection appears configured, list up to 30 source documents currently queued for posting, and categorize failed or skipped sync events from the last 1 to 365 days. Categories include authentication, account, tax, tracking or payment mapping, validation, rate limiting and service availability.

This check reads Solvantis records only. It does not contact Xero, refresh live Xero document states, retry or dismiss work, or expose raw error details, contact identities, tokens or request payloads. A historical failure may already have a later successful retry, so confirm the current source status in **Sync History** before acting.

## Step-by-step

### Configure a posting path

**Settings > Xero** contains advisor access controls and quick links. Select **Open Accounts & Tracking** to change account mappings in the Xero integration workspace. Mapping access, read-only Shopify payout access, and permission to trigger Xero syncs are separate advisor permissions.

1. Open **Xero > Setup > Sync Rules** and enable only the supported workflows your business intends to post.
2. Open **Accounts & Tracking** and map the required sales, purchasing, inventory, cost, tax, and branch or channel choices.
3. Open **Payment Methods** and map each enabled tender or gateway to the appropriate Xero account.

Bank accounts do not need a Chart of Accounts code to receive order payments. Select the account by name; accounts without a code are linked using their Xero account identity. A mapping is retained on screen only after the save succeeds. If saving fails, review the visible error and retry rather than assuming the selection was saved.

Changing a payment method's account mapping does not change the payment method already recorded on an existing payment. Check both the saved method and its account before posting. Previously posted payments need verified provider reversal and coordinated local retry reconciliation before their destination can be changed.

4. Under **POS Clearing Accounts**, keep each location's Card clearing account mapped, then select **Add fee** below it when that location has a percentage processing fee.
5. Choose the fee expense account, select **GST on Expenses** or **BAS Excluded**, enter the percentage, and save the fee.
6. The calculated fee posts from that location's Card clearing account after its EOD invoice payment or layby receipt posting succeeds. Use **Edit** or **Remove** beside the saved fee without changing the clearing account.
7. Save the mappings and run a normal source workflow.
8. Open **Sync History** and confirm the resulting status before enabling broader automation.

Online Sales Orders use the configured daily batch for their exact store. Solvantis does not also post those orders as individual Sales Order invoices or individual Sales Order payments. Ordinary manual and wholesale Sales Orders continue to follow the Sales Order document and payment rules.

Foreign-currency Purchase Order and ordinary Sales Order payments use the payment's saved exchange rate when posting to an AUD Xero account in an AUD-base organisation. Xero's rate display is the reciprocal of **AUD per foreign currency unit**; changing display direction does not change the value. Missing or invalid saved rates and unsupported payment-account currencies block posting rather than silently using a one-to-one conversion.

Check the resulting foreign amount and AUD bank amount against the actual payment. Previously posted payments are not automatically rewritten after a posting correction. If an existing payment has the wrong conversion, ask your bookkeeper to review its reversal and replacement and the Solvantis link before retrying; do not delete the Solvantis payment or create a second settlement to work around it.

For POS laybys, map **Layby Deposits** to a liability account, each branch's revenue to an income account, and every cash/card method to that branch's clearing account. POS clearing payments must be enabled. Deposits and refunds post to liability rather than ordinary sales invoices. Final payment recognises GST; collection recognises GST-exclusive merchandise revenue. Cancellation reverses final-payment GST when necessary and posts any retained fee as taxable revenue. These events use POS End of Day and its retry, including deposit-only days. Missing mappings block posting, and earlier layby accounting must finish before later events. Historical deposit sales invoices need explicit bookkeeper reconciliation rather than an automatic rewrite.

### Recover a failed accounting action

PO sync may approve a Draft or Submitted Xero bill when the configured document rules require approval. An already Authorised or Paid bill does not receive another approval request. Voided, deleted or unverified bill states block approval. This status check does not reverse settlements or create local payments to mirror Xero.

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

COGS journals use the configured COGS and Inventory Asset accounts. Each positive location-channel bucket debits COGS and credits Inventory Asset; negative adjustment buckets reverse those signs. Location and channel tracking mappings are applied where configured. Later runs post only the saved bucket differences, while legacy journals without a line-item snapshot remain explicitly unsplit rather than being assigned to a branch retrospectively.

## Review and recover COGS postings

Open **Xero > Activity > COGS** to review completed accounting periods from the last 12 months by default. Change the date range when older evidence is required. Each period compares current eligible COGS with recorded journals and, when available, verifies linked journal status directly with Xero.

Completed configured periods remain visible even when no journal run was created. An unresolved period does not stop later completed periods from posting. Solvantis keeps the earlier month visible in Accounting Audit and creates an IMS notification so it is not silently skipped.

1. Inspect the period's calculated COGS, amount Posted in Xero, difference and status. Actions are shown in their own column.
2. Open the period to review every original or adjustment run, including its signed amount, saved location-channel lines, cost checks, safe failure detail and Xero journal link.
3. For a confirmed failed run with no Xero journal, correct the named mapping or connection problem and press **Retry failed posting**. Solvantis retries only when the current period total still matches the failed run.
4. If costs changed after the failed attempt, review the revised period and use **Post COGS**. Solvantis posts the current required amount instead of replaying the old journal request.
5. When the period has missing or unexplained zero movement costs, choose **Fix Unknown COGS**. For each movement, select the current tax-exclusive AUD catalogue cost, current average cost, a foreign catalogue cost converted using the displayed current AUD rate, or enter a reviewed manual tax-exclusive AUD unit cost. Enter the evidence reviewed, then save all selected costs together.
6. Treat every suggestion as a review hint, not proof of historical cost. Current catalogue and average costs may have changed since the sale. A foreign hint records its native amount and displayed current conversion rate. A manual value must be AUD and tax-exclusive.
7. A FIFO repair requires an additional acknowledgement. It changes the movement COGS cost but does not rewrite existing FIFO layers or allocations, which may retain different historical evidence.
8. While costs are incomplete, the row offers **Fix Unknown COGS** and, for an administrator, **Post Known COGS**. It does not also show **Post COGS**. After all unknown costs are repaired, the posting choice changes to **Post COGS**.
9. For a linked Draft or Posted journal in an unlocked Xero period, open the period and choose **Update & post journal**. Solvantis recalculates the period, replaces that same journal's lines and submits it as Posted. Xero lock dates are checked before any update.
10. If Xero confirms that the linked journal no longer exists, the action changes to **Create replacement & post**. Solvantis creates a new journal, retains the missing journal ID in the run evidence, and links the replacement. A connection failure or unavailable live check never triggers a replacement.
11. If the outcome is unknown, do not retry it. The screen keeps uncertain work out of posted totals until the Xero outcome can be verified.
12. Confirm the resulting journal status and amount in Xero.

Administrators and Advisors with **Allow Advisors to trigger Xero syncs** can retry confirmed failures and post offered differences. Only an administrator can enter a required reason to post when missing or unexplained zero costs block the period. Draft, pending, successful, uncertain and live-unverified runs are not offered as ordinary retries.

**Costs incomplete** means the calculated COGS is only the known subtotal: one or more included stock movements has no cost or an unexplained zero cost. **Fix Unknown COGS** opens the reviewed movement repair workflow. **Post Known COGS** is the only posting choice shown while costs remain incomplete; it is an exceptional administrator action that records the reason and does not invent or repair missing costs. Once costs are complete, the row shows **Post COGS** instead.

COGS journals are requested from Xero as **Posted**, not saved as Draft by the normal workflow. A legacy or provider-retained Draft is shown in **Status** and can be reviewed from the period details; there is no separate Draft amount column. When live Xero verification succeeds, its current status overrides an older locally recorded state. **No posted journal recorded** means no Posted journal is currently confirmed for the period. **Xero check unavailable** means the live provider request failed, not that the recorded amount is verified as zero. Solvantis opens Xero's main entry point because Xero's legacy direct Manual Journal link is unavailable; copy the displayed journal ID to locate the journal and do not create a duplicate.

> **Warning:** Retrying COGS accounting does not repeat a sale, return, fulfilment or stock movement. Do not repeat an inventory operation to repair a journal failure.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Many entries fail together | Connection expired or Xero unavailable | Reauthorize and retry affected entries |
| One source is blocked | A required mapping or source condition is missing | Correct the named item and retry that entry |
| COGS does not reconcile | Missing or incomplete historical cost coverage, or journal not posted | Review COGS Reconciliation and source movement cost |
| COGS changes after a return or manager correction | The completed return or correction changed the period's captured movement cost | Review the revised period total and post the offered adjustment journal rather than repeating the source transaction |
| Shopify payout will not post | Invoice, credit, clearing account, fee account, tax, currency, or total does not balance | Fix the named difference and replan |
| Entry was dismissed | It was removed from the active queue, not synced | Find it in history and use the available manual retry if still required |

## Worked examples

### Operational success with accounting failure

Staff receive 10 units on a Purchase Order. Stock correctly rises by 10, but Xero rejects the bill because the purchasing account mapping is missing. Add the mapping and retry the Xero entry. Receiving another 10 would incorrectly double stock.

### Reconcile a Shopify payout

A paid payout contains sales, a refund, fees, and the net bank settlement. Review the payout plan, fix any blocked invoice, credit, account, tax, currency, or total mismatch, then replan. Post only when the package balances to the actual payout.


### Calculate a POS card fee

Newtown Card is configured for 1.75%. Successful card payments total $110.00 during the register session, so the EOD fee is $110.00 × 1.75% = $1.93 after currency rounding. After the card clearing payment succeeds, Solvantis posts a $1.93 Spend Money transaction from Newtown's Card clearing account to the selected fee expense account. A failed fee posting can be retried without repeating the invoice payment.
