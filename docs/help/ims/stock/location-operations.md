---
{"id":"ims-location-stock-operations","title":"Locations, Transfers, and Stocktakes","audiences":["ims"],"capability":"inventory","screen":"Locations and Stock","product":"ims","format":"overview","parentId":"ims-stock","relatedTopics":["ims-branch-transfers","ims-stocktakes-adjustments"],"contexts":["locations"],"contextSections":{"locations":"Locations"},"order":50,"summary":"Choose the right location workflow for branch setup, transfers, physical counts, and quantity corrections.","lastReviewed":"2026-08-23","owner":"inventory"}
---
# Locations, Transfers, and Stocktakes

Use this page to choose the physical-stock workflow that matches what happened in the store or warehouse.

## Main operations

| What happened | Start here | Do not substitute |
|---|---|---|
| Goods are moving between two branches | **Branch Transfers** | A negative adjustment at one branch and positive adjustment at another |
| A branch is counting a range of products | **Stocktakes** | A set of unrelated manual adjustments |
| One known quantity is wrong and no transfer or open count explains it | **Stock** quantity adjustment | A stocktake covering products that were not counted |
| A branch name, status, or operating setting changes | **Locations** | A stock movement; settings do not move existing goods |

## Locations

Locations identify the branches used by stock, POS, transfers, tracking, and reports. Select **Save** to add a location; a new location is not treated as a draft. The form stays open if you click outside it, so use **Cancel** or Escape to leave without saving.

Open a location's register controls to add or reactivate the tills that POS devices can use. The same register controls are available in **Settings > Point of Sale > Registers**, where location details remain read-only. Review open transfers, stocktakes, register use, and connected mappings before changing or deactivating a location. Changing a setting can affect where future work appears, but it does not move quantities already recorded there.

## Troubleshooting

| Symptom | Likely reason | What to do |
|---|---|---|
| Destination stock is missing | The transfer was sent but not received | Open **Receive Transfers** at the destination |
| A transfer is not in Receive Transfers | It is Draft, already Received, Cancelled, or for another destination | Search all statuses in **Branch Transfers** |
| A variance is surprising | The wrong location or product was counted, or stock moved during the count | Review the count details and movement timing before completion |
| One quantity needs correction | No broader physical count is required | Use the supported stock adjustment and record a clear reason |
| POS says no active registers exist | No usable till is configured for the selected location | Open **Settings > Point of Sale > Registers**, select the location, and add or reactivate a register |

## Worked examples

### Route a physical movement

The warehouse sends 6 lamps to the city store. Create and send one branch transfer for 6, then let the city store receive the quantity that physically arrives. Do not also reduce and increase the two stock balances manually.

### Route a single correction

The shelf and storeroom contain 14 mugs but the stock view shows 15. After checking that no sale, receipt, transfer, or stocktake is unfinished, use a quantity adjustment of -1 with a clear reason.