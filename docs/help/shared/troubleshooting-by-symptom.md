---
{"id":"shared-troubleshooting-by-symptom","title":"Troubleshooting by Symptom","audiences":["ims","pos","wholesale"],"capability":"navigation","screen":"Shared Help","product":"shared","format":"reference","contexts":["shared-troubleshooting"],"relatedTopics":["shared-plain-language-glossary"],"order":901,"summary":"Match a visible symptom to a safe first check, one sensible retry, and a clear point to stop.","lastReviewed":"2026-08-23","owner":"help"}
---
# Troubleshooting by Symptom

Use these lookup tables to recover safely without repeating payments, stock movements, orders, messages, or syncs.

## Main operations

- Read the full status or error before taking another action.
- Check whether the first action may already have succeeded.
- Retry once only when the page says it is safe and the cause has been corrected.
- Stop when the same result repeats or real-world state is unclear.
- Share only safe details when seeking support.

## Safe retry rules

| Situation | Before retrying | Safe action | Stop when |
| --- | --- | --- | --- |
| Payment result is unclear | Check receipt, sale status, terminal, and payment provider | Follow the POS payment recovery shown on screen | You cannot prove whether payment was taken |
| Stock action failed | Check current order, transfer, or stock status | Retry only if no movement was recorded and the workflow allows it | Quantity or location state is uncertain |
| Save or send failed | Reopen the record and check whether the new version or message exists | Correct the cause and retry once | A duplicate could reach a customer |
| Sync failed | Check connection, account, running status, and last update time | Fix the cause, then start one sync | Another sync is running or the same failure repeats |
| Page looks stale | Check selected business, filters, and last refresh time | Refresh the page once | Refresh changes nothing and source status is old |

> **Warning:** Never repeat a payment, refund, receipt, transfer send, transfer receive, order completion, or customer message until you have checked whether the first attempt was recorded.

## Find the symptom

| Symptom | First checks | Safe recovery | Stop and seek help when |
| --- | --- | --- | --- |
| Button is missing or disabled | Role, record status, required fields, selected location | Complete the earlier step or ask an administrator | The status appears eligible but the action remains unavailable |
| Data is old or missing | Business, date range, filters, connection, source update time | Correct filters or refresh the source once | Source refresh fails twice |
| Quantity differs from the shelf | Location, commitments, open transfers, recent receipts or sales | Follow stocktake or adjustment guidance after investigating | A sale, return, receipt, or transfer may be duplicated |
| Order status seems wrong | Line quantities, shipment or receipt history, remaining quantity | Reopen the owning order workflow | Real-world goods and recorded status disagree |
| Connection reports expired | Intended external account and connection status | Reconnect through Setup, then test once | The wrong account appears or access still fails |
| Payment failed | Sale status, terminal message, offline queue, provider result | Use the payment recovery offered by POS | Customer may have been charged but no sale is confirmed |
| Customer did not receive a message | Sent state, recipient, filtered mail, delivery result | Resend only when no sent record exists and the address is confirmed | A duplicate message could cause harm or confusion |
| Report totals differ | Dates, locations, tax basis, status, and source update time | Align settings and compare source records | Definitions match but the unexplained difference remains |
| Foresight says approved but nothing changed | Plan, recommendation, implementation, and execution stages | Open the implementation or execution result | External state cannot be confirmed |

## What to capture for support

| Safe detail | Example | Exclude |
| --- | --- | --- |
| Screen and action | "POS payment screen after selecting Card" | Passwords or sign-in codes |
| Business-safe reference | Order number or sale number shown to staff | Full card or bank details |
| Time and location | "23 August, 2:14 pm, Fitzroy" | Protected connection values |
| Exact visible status | "Execution failed" | Private customer messages unless requested through an approved support channel |
| Checks already completed | "Checked terminal and sale history; no receipt" | Repeated speculative retries |

## Troubleshooting sequence

| Step | Question | Action |
| --- | --- | --- |
| 1 | Could the action already have succeeded? | Check the owning record and external result where relevant |
| 2 | Is the selected business, location, account, or order correct? | Correct the selection before doing anything else |
| 3 | Is there a clear cause shown? | Correct that cause |
| 4 | Is one retry explicitly safe? | Retry once and read the complete result |
| 5 | Is the result still unclear or repeated? | Stop and seek help with safe details |

## Worked examples

### Unclear card payment

POS loses contact with the payment terminal after the customer taps. Do not charge again immediately. Check the terminal result, sale status, receipt history, and payment provider. Stop and escalate when the customer may have paid but the sale is not confirmed.

### Stale stock report

A stock report has no morning receipts. Confirm the business, location, filters, and source update time. Refresh the supported source once. If the refresh fails again, stop and report the screen, time, source name, and visible error without sharing protected access details.