---
{"id":"pos-petty-cash","title":"Petty Cash at POS","audiences":["pos","ims"],"capability":"pos","screen":"POS > Petty Cash","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-end-of-day-xero","pos-reports-transactions","pos-settings-terminals-offline-recovery"],"contexts":["pos-petty-cash"],"contextSections":{"pos-petty-cash":"Step-by-step"},"order":34,"summary":"Record a purchase paid from the open till with its GST treatment, reason, and receipt evidence.","lastReviewed":"2026-08-31","owner":"retail"}
---
# Petty Cash at POS

Record money removed from the open till for a business purchase at the time it occurs.

## Main operations

- Enter the exact amount paid from the till.
- Record the purchase or supplier reason.
- Choose **GST on Expenses** or **BAS Excluded**.
- Attach a receipt photo or PDF.
- Record the entry and open the till.
- Use the entry when explaining the cash count at End of Day.

## At a glance

| Field | Requirement |
|---|---|
| Amount | Positive amount greater than $0.00 |
| Purchase / Supplier | Required, up to the displayed field limit |
| GST | Choose the treatment shown on the source document |
| Receipt | Required JPG, PNG, WebP, image capture, or PDF |
| Register | Must be an open active register session |
| Training/offline use | Unavailable |

## Before you begin

- [ ] Confirm the purchase was paid from this register's till.
- [ ] Confirm the register is open and POS is online.
- [ ] Keep the readable receipt or tax invoice ready.
- [ ] Determine whether the purchase has GST on expenses or is BAS excluded.

> **Important:** Choose the GST treatment from the supplier document. Do not add 10% to the amount entered; record the amount actually paid.

## Step-by-step

1. Choose **Petty Cash** from the POS toolbar.
2. Enter the amount removed from the till.
3. Enter the purchase or supplier reason.
4. Choose **GST on Expenses** when the source document supports that treatment, otherwise choose **BAS Excluded** where appropriate.
5. Under **Receipt**, take a photo or choose the receipt file.
6. Check the amount, reason, treatment, and attachment.
7. Choose **Record & open till**.
8. Confirm POS reports **Petty cash recorded** before closing the dialog or entering it again.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Amount is rejected | It is empty, zero, negative, or invalid | Enter the positive amount actually paid |
| Entry cannot be recorded | The reason or receipt is missing | Complete both required fields |
| Petty Cash is unavailable | The register is not open, POS is offline, or Training Mode is active | Restore the required live register state |
| Receipt upload fails | The file is unsupported or unreadable | Use a clear supported image or PDF and retry online |
| End of Day cash is lower than sales suggest | Cash was removed for the recorded purchase | Compare the petty-cash entry and receipt before recording an unexplained variance |

## Worked examples

### Record cleaning supplies

Staff pay $22 from the till for cleaning supplies and receive a tax invoice showing GST. They enter $22, name the supplier and purpose, choose **GST on Expenses**, attach the receipt, and record the entry. At End of Day, the $22 explains why physical cash is lower than cash sales alone.
