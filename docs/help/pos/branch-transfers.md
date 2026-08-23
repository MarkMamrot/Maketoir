---
{"id":"pos-branch-transfers","title":"POS Branch Transfers","audiences":["pos","ims"],"capability":"pos","screen":"POS > Create Transfer and Receive Transfers","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-selling-payments-manager-approval","ims-location-stock-operations"],"contexts":["receive-transfers","branch-transfer"],"contextSections":{"receive-transfers":"Step-by-step","branch-transfer":"Step-by-step"},"order":30,"summary":"Send stock from the active POS branch and receive it at the destination without duplicating movements.","lastReviewed":"2026-08-23","owner":"retail"}
---
# POS Branch Transfers

Use POS Branch Transfers to record stock leaving one branch and arriving at another in two controlled stages.

## Main operations

- Create a transfer only from the branch shown on the POS device.
- Select another active location as the destination.
- Scan or search the exact variants and enter sent quantities.
- Use a manager PIN when the business has set transfer access to Manager.
- Receive and confirm the physical quantities at the destination.
- Review outgoing sent, partial, and received transfer history from the source screen.

## At a glance

| Status | Stock position | Where it appears in POS |
|---|---|---|
| Sent | Source movement is recorded; goods await destination receipt | Source history and destination **Receive Transfers** |
| Partial | Some quantity has been received and some remains unresolved | Source history and destination **Receive Transfers** |
| Received | Destination receipt is complete | Source transfer history; it leaves the destination receive list |
| Cancelled | Transfer is no longer active | Review full transfer history in IMS |

## Before you begin

- [ ] Confirm the POS header shows the physical source branch.
- [ ] Count the goods being sent.
- [ ] Confirm the destination before adding items.
- [ ] Have the location manager available if transfer access is set to Manager.
- [ ] Keep the transfer reference with the shipment.

> **Warning:** Sending commits the source stock movement immediately. Do not send a duplicate transfer because the destination cannot yet see the first one; refresh and check its status first.

## Step-by-step

### Send from the source

1. Open the POS menu and select **Create Transfer**. If the action is hidden, POS transfer creation is disabled for this business.
2. Confirm **From** is the current branch and choose **Send To**.
3. Scan a barcode or SKU, or search by product name, SKU, or barcode.
4. Enter the quantity physically packed for each variant and add an optional note.
5. Select **Send Transfer**. If prompted, ask the location manager to enter their PIN.
6. Keep the success message and transfer number with the goods.

### Receive at the destination

1. On a POS device assigned to the destination, open **Receive Transfers**.
2. Select the incoming Sent or Partial transfer.
3. Compare each line with the physical delivery and enter the quantity actually received.
4. Complete the receipt. Destination stock is recorded for the confirmed quantity.
5. If all expected goods are resolved, the transfer becomes Received and disappears from **Receive Transfers**.

## Permission and movement rules

| POS transfer setting | Staff experience |
|---|---|
| Disabled | **Create Transfer** is hidden and POS creation is rejected |
| Manager | The send action asks for the location manager PIN |
| All | The signed-in POS operator can send without that extra prompt |

Receiving is limited to Sent or Partial transfers addressed to the active POS location. A completed Received transfer remains available in the source history and the full IMS Branch Transfers history.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Create Transfer is missing | POS transfer access is Disabled | Ask an Admin to review the POS transfer permission |
| Manager PIN appears | Transfer access is set to Manager | Ask the authorised location manager to enter their PIN |
| Incoming transfer is not listed | It is for another destination, is still Draft, or is already Received/Cancelled | Check destination and status in the transfer history |
| An item cannot be found by scan | The barcode/SKU is wrong or the variant lookup needs a connection | Search by name or reconnect and retry the scan |
| Destination stock is still missing | The transfer was sent but not received | Complete **Receive Transfers** at the destination; do not add a separate positive adjustment |

## Worked examples

### Send 8 units and receive 7

Bondi sends 8 black tees to QVB. The transfer becomes Sent and Bondi's source movement is recorded. QVB physically receives 7 and records that quantity, leaving the transfer Partial while the missing unit is investigated. QVB does not receive 8 or create a separate adjustment just to force the transfer closed.

## Related tasks

See **Selling, Payments, and Manager Approval** for manager prompts and **Locations, Transfers, and Stocktakes** for the full IMS transfer history.