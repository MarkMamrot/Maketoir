---
{"id":"ims-branch-transfers","title":"Branch Transfers","audiences":["ims"],"capability":"inventory","screen":"Locations > Branch Transfers","product":"ims","format":"task","parentId":"ims-location-stock-operations","relatedTopics":["ims-stocktakes-adjustments"],"contexts":["branch-transfers","smart-device-receive","receive-transfers"],"contextSections":{"branch-transfers":"Step-by-step","smart-device-receive":"Step-by-step","receive-transfers":"Step-by-step"},"order":51,"summary":"Create, send, track, and receive stock moving between branches, including short and partial receipts.","lastReviewed":"2026-08-30","owner":"inventory"}
---
# Branch Transfers

Use one branch transfer to record goods leaving a source, travelling between branches, and arriving at the destination.

## Main operations

- Create and review a Draft transfer.
- Add multiline transfer notes for packing instructions or selected Store Daybook needs.
- Send the transfer when goods leave the source.
- Keep Sent goods in transit until the destination counts them.
- Edit a Sent transfer when its route, lines, quantities, costs, or notes need correction before receipt.
- Receive the actual quantities or save a partial receipt for later.
- Undo a mistaken partial or completed receipt and reopen the transfer as Sent.
- Find completed transfer history in Branch Transfers.

## At a glance

| Status | Physical meaning | Stock position | Next action |
|---|---|---|---|
| Draft | Goods have not been dispatched | Source and destination are unchanged | Edit, send, cancel, or delete as offered |
| Sent | Goods left the source and are in transit | Sent quantities are committed at the source; destination has not received them | Edit a dispatch error or receive at the destination |
| Partially Received | Some quantities arrived or were confirmed | Only received quantities are at the destination; short lines remain visible | Continue receiving, finalise reviewed shorts, or undo a mistaken receipt |
| Received | Destination receipt is finished | Actual received quantities are recorded at the destination | Review it or undo a mistaken receipt |
| Cancelled | Transfer will not proceed | Retained for audit | Create a new transfer if goods move later |

## Before you begin

- [ ] Confirm the source and destination are different active locations.
- [ ] Count the variants and quantities being packed.
- [ ] Check for another transfer covering the same goods.
- [ ] At receipt, compare the transfer with the physical shipment before entering quantities.

> **Important:** Sending and receiving are separate stages. Do not make matching manual adjustments at either branch for goods already covered by the transfer.

When the destination allows POS sales from incoming transfers, POS can sell the same variant before receipt up to the transfer's outstanding quantity. The destination may temporarily show negative stock, and IMS Notifications identifies the sale for warehouse review. Receiving the transfer adds the confirmed arrival against that balance; do not create a separate adjustment.

## Step-by-step

### Create and send

1. Open **Locations > Branch Transfers** and select **New Transfer**.
2. Choose the source, destination, transfer date, and any useful packing notes. Notes support multiple lines. You can paste the combined clipboard built from Store Daybook Requests and Store needs; each copied request is separated by blank space and a divider.
3. Add each product variant and quantity to send, then save the Draft.
4. Review the transfer number, route, items, quantities, and value.
	The Zone and Bin shown for each line are the storage coordinates at the transfer's source location, normally the warehouse. They are not the destination branch coordinates.
5. Use **Print** when a paper transfer is needed. The saved notes print in a separate section at the bottom, after all item lines.
6. Mark the transfer **Sent** only when the goods physically leave the source.
7. If a Sent transfer is wrong, use **Edit** before any receipt is recorded. Saving releases the previous source commitments and applies the corrected route and lines.

> **Important:** Once receipt has started, use **Undo Receipt** before editing the transfer. This keeps destination stock and the transfer record aligned.

### Receive at the destination

1. Open **Receive Transfers** and choose the destination branch. Only Sent and Partially Received transfers appear here.
2. Open the transfer. Received quantities begin at 0; scan each item or enter the quantity physically present.
3. Use **Receive All** only after confirming every sent quantity arrived.
4. Choose **Save & Continue Later** when more goods or checking is required. The transfer remains Partially Received.
5. Choose **Confirm Receipt & Move Stock** when the entered receipt is final.
6. For a partial transfer, use **Manage Partial** to review received quantities and short lines before marking it Received.

### Undo a mistaken receipt

1. Open **Locations > Branch Transfers** and find the Partially Received or Received transfer.
2. Select **Undo Receipt** and review the confirmation carefully.
3. Confirm only when the receipt was recorded against the wrong transfer, branch, or quantities.
4. The received quantities are removed from the destination and returned to the source. The transfer reopens as Sent so the destination can receive it again correctly.

> **Warning:** Undo Receipt is blocked when the destination no longer has enough of a variant to reverse all quantities received on the transfer. Review later sales, adjustments, or transfers for that stock before trying again. Do not use a manual adjustment to force the reversal.

## Troubleshooting

| Symptom | Likely reason | What to do |
|---|---|---|
| Transfer is missing from Receive Transfers | It is Draft, Received, Cancelled, or for another destination | Search the transfer number in Branch Transfers and check status and route |
| Destination quantity is still 0 | The transfer was sent but not received | Count the goods and complete the destination receipt |
| IMS reports a POS sale used incoming transfer stock | The destination sold goods before recording this transfer's receipt | Confirm the goods arrived, complete the matching receipt, and verify destination stock |
| Fewer goods arrived than sent | The shipment is short or still split | Enter only what arrived and save partial, or finalise the reviewed short quantity |
| Undo Receipt says destination stock is insufficient | Some received stock has since been sold, adjusted, or moved | Review the variant's later activity and correct that activity first; then retry Undo Receipt |
| A barcode does not match | The scanned SKU is not on this transfer | Stop and identify the item; do not add it as a different line casually |

## Worked examples

### Send, hold in transit, and receive

The warehouse sends 12 mugs costing $8 each, transfer value $96. Marking the transfer Sent records 12 leaving the warehouse. While travelling, the store has not received them. The store counts 12 and confirms receipt, adding 12 to the destination once.

### Receive a short shipment

A transfer says 10 jackets were sent, but the branch receives 8. Enter 8 and choose **Save & Continue Later** while the other 2 are checked. If the final confirmed receipt remains 8, manage the partial transfer and mark it Received with the short quantity still visible in the transfer record.

### Correct a receipt recorded against the wrong transfer

A branch records 6 lamps as received, then discovers the cartons belong to another transfer. Use **Undo Receipt** before recording the correct transfer. The 6 lamps leave the destination stock, return to the source stock, and the original transfer returns to Sent with its received quantities cleared.