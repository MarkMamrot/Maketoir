---
{"id":"setup-runtime-issues","title":"Runtime Issues","audiences":["ims"],"capability":"integrations","screen":"SuperAdmin > Runtime Issues","product":"setup","format":"task","parentId":"setup-connections","contexts":["runtime-issues"],"contextSections":{"runtime-issues":"Step-by-step"},"relatedTopics":["setup-integration-readiness-troubleshooting","setup-team-access-security"],"order":6,"summary":"Review operational failures, record the outcome, and close only issues that have been verified.","lastReviewed":"2026-08-26","owner":"platform"}
---
# Runtime Issues

Runtime Issues gives SuperAdmins one place to review application exceptions and integration failures across businesses. Repeated occurrences of the same failure are grouped into one issue.

## Main operations

- Review new issues in small batches.
- Start with the latest occurrence, then use earlier occurrences to confirm whether the pattern changed.
- Check the affected business, operation, dates, occurrence count, context, and history.
- Record a concise resolution note before marking an issue fixed.
- Keep an issue open when stock, money, customer value, or external-system state still needs a decision.

## At a glance

| Status | Meaning |
| --- | --- |
| New | The issue has not been verified or resolved |
| In progress | Investigation or an external action is still underway |
| Fixed | The cause or affected operational state has been verified as resolved |

A fixed issue automatically returns to **New** if the same failure occurs again. This makes it safe to close verified historical incidents without hiding a recurrence.

## Before you begin

- Confirm you are signed in as a SuperAdmin.
- Have access to the affected business and relevant external service when verification requires it.
- Do not change stock, accounting, customer value, or integration links unless the intended correction is clear and authorised.
- Treat context and stack details as diagnostic evidence, not as instructions to repeat an action.

## Step-by-step

1. Open **Admin** and select **Runtime Issues**.
2. Choose **New** or **In progress**, then narrow the list by business, source, severity, or search.
3. Open an issue to view its latest context and occurrence history in the side panel.
4. Check the most recent occurrence first. Compare older entries when the message or context has changed.
5. Verify the current code, configuration, external service, or affected record as appropriate.
6. Enter resolution notes that state what was checked and why the selected status is accurate.
7. Select **In progress** when work or a decision remains, or **Mark fixed** only after verification.

> **Important:** A stopped recurrence is useful evidence, but it does not prove that affected stock, payments, orders, gift cards, or external links are correct. Verify those records separately.

## Reading the detail panel

The fixed header keeps the severity, source, operation, and close control visible while scrolling. Summary details show the business, occurrence count, first-seen time, and last-seen time. Latest context describes the newest occurrence, while Occurrence history retains earlier evidence and status changes.

## Resolution notes

Useful notes state the verified outcome in plain language. Include whether the issue was a code correction, configuration change, completed migration, resolved external incident, or reviewed business record. If no data was changed, say so when that distinction matters.

Avoid credentials, access tokens, customer details, or raw external payloads in resolution notes.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| A fixed issue appears under New again | The same fingerprint occurred after it was closed | Review the newest occurrence; do not assume the earlier fix covered it |
| A recurring issue has many occurrences | Repeated events were grouped together | Start with the latest event and compare only enough history to establish the pattern |
| An issue references stock, money, or customer value | Operational data may need review | Keep it open until the intended correction is authorised and verified |
| An issue references an external ID that no longer exists | The local integration link may be stale | Verify identity in the external service before relinking or clearing anything |
| A button is disabled | A status update is already saving | Wait for the list to refresh before taking another action |

## Worked examples

A missing tenant table that has since been deployed to every active business can be marked fixed after each tenant is verified. The resolution note should identify the completed rollout and state that no business records were changed.

A Shopify fulfilment failure caused by insufficient stock should remain open if the order is still unfulfilled. Stock at another branch does not by itself authorise a transfer or a change of fulfilment location. Recorded incoming stock can support an automatic Shopify fulfilment when it fully covers the shortage; staff must still complete the receipt and verify location stock after the warning.
