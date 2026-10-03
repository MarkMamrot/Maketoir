---
{"id":"setup-integration-readiness-troubleshooting","title":"Integration Readiness and Troubleshooting","audiences":["ims"],"capability":"integrations","screen":"Setup > Connections; IMS Settings > Sync & Import","product":"setup","format":"task","parentId":"setup-connections","contexts":["integration-readiness-troubleshooting"],"contextSections":{"integration-readiness-troubleshooting":"Step-by-step"},"relatedTopics":["setup-connections","foresight-business-intelligence","shared-troubleshooting-by-symptom"],"order":4,"summary":"Check account access, required follow-up setup, source freshness, and safe recovery before relying on an integration.","lastReviewed":"2026-10-03","owner":"integrations","quickSections":["Main operations","At a glance"]}
---
# Integration Readiness and Troubleshooting

Use this guide when a connection says it is connected but a sync, report, or downstream workflow is not ready.

## Main operations

- Confirm the business and external account shown on screen.
- Separate account access from mapping and workflow readiness.
- Confirm the intended Cin7 account when importing data into IMS.
- Run one controlled test or refresh and read the result.
- Stop repeated retries when the same problem remains.

## At a glance

| Check | Ready when | If not ready |
| --- | --- | --- |
| Account access | Intended account is shown and status succeeds | Reconnect or correct access |
| Required permissions | The enabled workflow can read or perform its stated action | Reauthorise with the required access through the normal flow |
| Product settings | Required mappings and policies are complete | Finish setup in the owning product area |
| Freshness | Test or refresh completes and the time or result is current | Investigate the connection before relying on reports |

## Before you begin

- Select the intended Solvantis business.
- Know which external organisation, store, advertising account, or property should be connected.
- Avoid starting another sync while one is still running.
- Record the visible time and wording of an error without including private access details.

> **Important:** "Connected" confirms access, not complete readiness. Xero mappings, Shopify product rules, selected advertising accounts, and imported IMS data may still need attention.

## Step-by-step

1. Open **Connections** and confirm the intended business.
2. Find the affected service and check the displayed account identity and status.
3. If access is expired or the wrong account is shown, reconnect through the normal flow.
4. Open the owning product settings and complete required mappings, policies, or account selections.
5. Open **IMS Settings > Sync & Import** to run the intended Cin7 import or refresh the sales cache.
6. Run one supported test, sync, or cache refresh.
7. Read the full result, including warnings and the displayed update time.
8. If it fails again for the same reason, stop and seek support with the safe details shown on screen.

## Inventory data in IMS

IMS is the inventory source used by Solvantis reports and operations. Cin7 can be connected as an upstream system and imported into IMS; it is not a selectable alternative reporting source. After an import or refresh, confirm the completed status and cache timestamp before comparing results.

## Symptom and recovery

| Symptom | Likely cause | Safe recovery |
| --- | --- | --- |
| Connection says expired | External authorisation ended | Reconnect the intended account, then test once |
| Status succeeds but no data appears | A mapping, date range, or first import is missing | Check downstream setup and source freshness |
| Only one Google service is ready | Ads account or Analytics property is not selected | Select the missing account or property and recheck status |
| Shopify items do not match | Product mapping or source ownership is incomplete | Review Shopify setup before another broad sync |
| Xero posting is unavailable | Accounts, tax, tracking, payment routing, or policy is incomplete | Finish Xero Setup; connection alone is not enough |
| A sync appears stuck | It may still be running or the result has not refreshed | Wait, refresh status once, and do not start an overlapping sync |
| The same test fails twice | The underlying access or setup problem remains | Stop retrying and seek support with service name, time, and safe error wording |

## Troubleshooting

| What to share | Safe example | Do not share |
| --- | --- | --- |
| Service and account label | "Google Ads for Northside Retail" | Sign-in or access values |
| Time and action | "Tested at 10:15 AEST after reconnecting" | Authenticator or recovery codes |
| Visible error wording | The exact non-sensitive message | Private customer payloads or protected connection fields |
| Retry count | "One test and one retry" | Repeated screenshots containing private values |

## Worked examples

### Recover a stale Google connection

Setup shows Google authorised, but Analytics is not connected. Confirm the intended Google account, select the correct Analytics property, and check status again. Refresh marketing information once after both Ads and Analytics show ready.

### Refresh IMS reporting data

IMS is the inventory source for Solvantis reports. When upstream Cin7 records have changed, open **IMS Settings > Sync & Import**, run the required import, then select **Refresh Sales Cache**. Confirm the updated variant count and time before comparing reports.