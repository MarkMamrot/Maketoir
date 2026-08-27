---
{"id":"ims-branch-transfers","title":"Branch Transfers","audiences":["ims"],"capability":"inventory","screen":"Locations > Branch Transfers","product":"ims","format":"task","parentId":"ims-location-stock-operations","relatedTopics":["ims-stocktakes-adjustments"],"contexts":["branch-transfers","smart-device-receive","receive-transfers"],"contextSections":{"branch-transfers":"Step-by-step","smart-device-receive":"Step-by-step","receive-transfers":"Step-by-step"},"order":51,"summary":"Create, send, track, and receive stock moving between branches, including short and partial receipts.","lastReviewed":"2026-08-23","owner":"inventory"}
---
# Branch Transfers

Use one branch transfer to record goods leaving a source, travelling between branches, and arriving at the destination.

## Main operations

- Create and review a Draft transfer.
- Add multiline transfer notes for packing instructions or selected Store Daybook needs.
- Send the transfer when goods leave the source.
- Keep Sent goods in transit until the destination counts them.
- Receive the actual quantities or save a partial receipt for later.
- Find completed transfer history in Branch Transfers.

## At a glance

| Status | Physical meaning | Stock position | Next action |
|---|---|---|---|
| Draft | Goods have not been dispatched | Source and destination are unchanged | Edit, send, cancel, or delete as offered |
| Sent | Goods left the source and are in transit | Source movement is recorded; destination has not received them | Destination counts and receives |
| Partially Received | Some quantities arrived or were confirmed | Only received quantities are at the destination; short lines remain visible | Continue receiving or finalise reviewed shorts |
| Received | Destination receipt is finished | Actual received quantities are recorded at the destination | Review in Branch Transfers history |
| Cancelled | Transfer will not proceed | Retained for audit | Create a new transfer if goods move later |

## Before you begin

- [ ] Confirm the source and destination are different active locations.
- [ ] Count the variants and quantities being packed.
- [ ] Check for another transfer covering the same goods.
- [ ] At receipt, compare the transfer with the physical shipment before entering quantities.

> **Important:** Sending and receiving are separate stages. Do not make matching manual adjustments at either branch for goods already covered by the transfer.

## Step-by-step

### Create and send

1. Open **Locations > Branch Transfers** and select **New Transfer**.
2. Choose the source, destination, transfer date, and any useful packing notes. Notes support multiple lines. You can paste the combined clipboard built from Store Daybook Requests and Store needs; each copied request is separated by blank space and a divider.
3. Add each product variant and quantity to send, then save the Draft.
4. Review the transfer number, route, items, quantities, and value.
5. Use **Print** when a paper transfer is needed. The saved notes print in a separate section at the bottom, after all item lines.
6. Mark the transfer **Sent** only when the goods physically leave the source.

### Receive at the destination

1. Open **Receive Transfers** and choose the destination branch. Only Sent and Partially Received transfers appear here.
2. Open the transfer. Received quantities begin at 0; scan each item or enter the quantity physically present.
3. Use **Receive All** only after confirming every sent quantity arrived.
4. Choose **Save & Continue Later** when more goods or checking is required. The transfer remains Partially Received.
5. Choose **Confirm Receipt & Move Stock** when the entered receipt is final.
6. For a partial transfer, use **Manage Partial** to review received quantities and short lines before marking it Received.

## Troubleshooting

| Symptom | Likely reason | What to do |
|---|---|---|
| Transfer is missing from Receive Transfers | It is Draft, Received, Cancelled, or for another destination | Search the transfer number in Branch Transfers and check status and route |
| Destination quantity is still 0 | The transfer was sent but not received | Count the goods and complete the destination receipt |
| Fewer goods arrived than sent | The shipment is short or still split | Enter only what arrived and save partial, or finalise the reviewed short quantity |
| A barcode does not match | The scanned SKU is not on this transfer | Stop and identify the item; do not add it as a different line casually |

## Worked examples

### Send, hold in transit, and receive

The warehouse sends 12 mugs costing $8 each, transfer value $96. Marking the transfer Sent records 12 leaving the warehouse. While travelling, the store has not received them. The store counts 12 and confirms receipt, adding 12 to the destination once.

### Receive a short shipment

A transfer says 10 jackets were sent, but the branch receives 8. Enter 8 and choose **Save & Continue Later** while the other 2 are checked. If the final confirmed receipt remains 8, manage the partial transfer and mark it Received with the short quantity still visible in the transfer record.