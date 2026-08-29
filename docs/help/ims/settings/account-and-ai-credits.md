---
{"id":"ims-settings-account-ai-credits","title":"Account & AI Credits","audiences":["ims"],"capability":"navigation","screen":"IMS Settings > Account & AI Credits","product":"ims","format":"task","parentId":"ims-settings-business-operations-pos","contexts":["ims-settings-ai-account","ai-account"],"contextSections":{"ims-settings-ai-account":"Step-by-step","ai-account":"Understand available AI value"},"relatedTopics":["ims-settings-ai-models","foresight-business-intelligence","foresight-content-production-customer-service"],"order":4,"summary":"View your Solvantis AI plan, available usage value, reservations, recent usage, and account status.","lastReviewed":"2026-08-30","owner":"ims"}
---
# Account & AI Credits

Use Account & AI Credits to see whether AI is available, how much AI usage value remains, and which areas have consumed value recently.

## Main operations

- Check the current Solvantis plan and AI account type.
- View available, reserved, used, or prepaid AI value in AUD.
- Review recent usage by area, model, operation, and status.
- Confirm when a cycle-based account resets.
- Identify an exhausted or suspended account before starting AI work.

## At a glance

| Display | Meaning | What to do |
| --- | --- | --- |
| Available | Value that can still be reserved for new AI work | Contact your administrator before it reaches zero if more work is expected |
| Reserved | Value held for requests that are running or awaiting final usage details | Wait for active work to finish; contact support if a reservation remains unexpectedly |
| Credit balance | Prepaid AI usage value remaining | Ask an administrator to add credit when required |
| Cycle used and limit | AI usage value consumed in the current account period | Plan work within the remaining value or request a limit change |
| Observe | Usage is recorded but the account is not blocked at zero | Treat the figures as live usage information while commercial settings are finalised |
| Enforce | New AI work stops when available value reaches zero | Restore credit, raise the limit, or wait for the next eligible reset |
| Suspended | New AI work is disabled by an administrator | Contact your administrator |

## Before you begin

- Open IMS with an authenticated back-office account.
- Remember that the displayed amount is AI usage value in AUD, not a count of interchangeable tokens.
- Different models and different input, output, image, or video work can consume different amounts.
- Keep financial documents, stock changes, and customer-facing outputs under human review regardless of available credit.

> **Important:** Reaching zero on an enforced account stops new billable AI work before it is sent for generation. Existing non-AI IMS work remains available.

## Step-by-step

1. Open **IMS Settings**.
2. Select **Account & AI Credits**.
3. Check **Available** and **Status**.
4. Review **Reserved** if work is already running.
5. Review the last 30 days by area to see where value was consumed.
6. Review recent usage for the model, operation, status, and charge.
7. Contact your administrator when credit, a limit change, a reset, or restoration is required.

## Understand available AI value

A prepaid account spends from a credit balance. An account-limit account records usage against a limit for its configured cycle. Calendar cycles reset at the start of a month in the account timezone. Anniversary cycles reset on the configured day, with shorter months ending on their last day. Manual cycles reset only when an administrator performs the reset.

Solvantis reserves a conservative amount before generation starts so simultaneous requests cannot exceed an enforced account. After a successful request, the actual usage charge replaces the reservation. A request whose final provider status is uncertain can remain reserved for review instead of being treated as free usage.

## Troubleshooting

| Symptom | Likely cause | Safe action |
| --- | --- | --- |
| AI says credits have run out | An enforced prepaid balance has no available value | Ask a SuperAdmin to add prepaid credit |
| AI says the account limit was reached | Current-cycle usage and reservations reached the limit | Ask a SuperAdmin to raise or reset the limit, or wait for the next automatic cycle |
| AI says pricing is unavailable | The selected model does not have complete active pricing | Choose a configured model or ask a SuperAdmin to complete its rates |
| Available is lower than the balance | Value is reserved by running or unresolved requests | Wait for current work to finish; report a long-lived reservation for review |
| AI remains unavailable after an adjustment | The account is suspended or the page is stale | Refresh Account & AI Credits and ask the administrator to confirm the account status |

## Worked examples

### Prepaid account reaches zero

A team uses document extraction, catalogue matching, and website content during a product intake. The available value reaches zero while enforcement is active. New AI requests stop before generation, but staff can continue ordinary IMS work. A SuperAdmin records a prepaid credit adjustment with its payment or approval reference. AI becomes available immediately after the account has positive available value.

### Account limit with reserved work

A business has a monthly account limit. Two large document requests are running, so their estimated value appears under Reserved. The available amount reflects cycle usage plus those reservations. When each request finishes, Solvantis replaces its reservation with the actual charge. The cycle resets at the configured local boundary, while unresolved requests remain visible for administrator review.